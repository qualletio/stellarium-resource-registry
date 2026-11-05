import { eq, inArray } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { nodesTable, structTypesTable, structTypeVersionsTable } from "../db/schema.js";
import type { NodeClient, NodeStruct } from "../node/nodeClient.js";
import { compareVersions } from "../registry/registryRepository.js";

export interface StructSyncLogger {
    warn(obj: object, msg?: string): void;
}

export interface StructSyncOptions {
    clientFor: (baseUrl: string) => NodeClient;
    /** Runs `task` on every item, a few at a time. */
    forEach: <T>(items: T[], task: (item: T) => Promise<void>) => Promise<void>;
    logger?: StructSyncLogger;
}

/** A version as the registry stores it, whether just read from its node or kept from an earlier sync. */
interface StructVersionValues {
    path: string;
    name: string;
    version: string;
    fields: { name: string; type: string }[];
    description: string | null;
    baseUrl: string;
    declaredAt: Date;
}

const fqnOf = (item: { path: string; name: string }) => `${item.path}.${item.name}`;

const toValues = (struct: NodeStruct): StructVersionValues => ({
    path: struct.path,
    name: struct.name,
    version: struct.version,
    fields: struct.fields,
    description: struct.description ?? null,
    baseUrl: struct.baseUrl,
    declaredAt: struct.createdAt,
});

/** The structs a node declared itself. Null when it couldn't be read; none when it predates structs. */
async function readNode(client: NodeClient, logger: StructSyncLogger | undefined): Promise<NodeStruct[] | null> {
    try {
        const result = await client.getAllStructs();
        if (!result) return [];
        if (result.invalid > 0) logger?.warn({ host: client.baseUrl, invalid: result.invalid }, 'Skipped malformed structs');
        // A node also lists the structs it learned, each with the node that declared it. Only that node is believed.
        return result.structs.filter((struct) => struct.baseUrl === client.baseUrl);
    } catch (error) {
        logger?.warn({ host: client.baseUrl, err: error instanceof Error ? error.message : String(error) }, 'Reading structs failed');
        return null;
    }
}

/**
 * Reads the structs every node the registry knows declared. A struct's path belongs to one organization and
 * any of its nodes may declare a version, so a struct's versions are gathered from all of them, each from
 * the node that declared it. When organizations' nodes claim the same path (nodes keep the first declaration
 * they see), the registry keeps the owner it has, unless none of its nodes lists the struct any more, and
 * otherwise the organization with the earliest declaration. A version whose node can't be read is kept as
 * stored. A struct no node lists is marked removed, keeping its versions so its page still shows them.
 */
export async function syncStructs(db: Database, options: StructSyncOptions): Promise<void> {
    const nodes = await db.select({ id: nodesTable.id, baseUrl: nodesTable.baseUrl }).from(nodesTable);
    const nodeIds = new Map(nodes.map((node) => [node.baseUrl, node.id]));

    const unreadable = new Set<string>();
    // fqn → owner organization → version → the version, as declared.
    const claims = new Map<string, Map<string, Map<string, StructVersionValues>>>();
    const owners = new Map<string, Map<string, number>>();
    await options.forEach(nodes, async (node) => {
        const structs = await readNode(options.clientFor(node.baseUrl), options.logger);
        if (structs === null) {
            unreadable.add(node.baseUrl);
            return;
        }
        for (const struct of structs) {
            const byOwner = claims.get(fqnOf(struct)) ?? new Map<string, Map<string, StructVersionValues>>();
            const versions = byOwner.get(struct.ownerOrganizationId) ?? new Map<string, StructVersionValues>();
            // Two nodes of one organization can each declare a version before they learn the other's. The earlier wins.
            const existing = versions.get(struct.version);
            if (!existing || struct.createdAt < existing.declaredAt) versions.set(struct.version, toValues(struct));
            byOwner.set(struct.ownerOrganizationId, versions);
            claims.set(fqnOf(struct), byOwner);

            const since = owners.get(fqnOf(struct)) ?? new Map<string, number>();
            since.set(struct.ownerOrganizationId, Math.min(since.get(struct.ownerOrganizationId) ?? Infinity, struct.createdAt.getTime()));
            owners.set(fqnOf(struct), since);
        }
    });

    await db.transaction(async (tx) => {
        const now = new Date();
        const stored = new Map((await tx.select().from(structTypesTable)).map((row) => [row.fqn, row]));
        // Versions declared on nodes that couldn't be read, kept until those nodes can be.
        const kept = new Map<number, StructVersionValues[]>();
        if (unreadable.size > 0) {
            const rows = await tx.select({ version: structTypeVersionsTable, path: structTypesTable.path, name: structTypesTable.name })
                .from(structTypeVersionsTable)
                .innerJoin(structTypesTable, eq(structTypesTable.id, structTypeVersionsTable.structTypeId))
                .where(inArray(structTypeVersionsTable.baseUrl, [...unreadable]));
            for (const { version, path, name } of rows) {
                kept.set(version.structTypeId, [...kept.get(version.structTypeId) ?? [], { ...version, path, name }]);
            }
        }

        const fqns = new Set([...claims.keys(), ...[...stored.values()].filter((row) => row.removedAt === null).map((row) => row.fqn)]);
        for (const fqn of fqns) {
            const row = stored.get(fqn);
            const byOwner = claims.get(fqn) ?? new Map<string, Map<string, StructVersionValues>>();
            const keptVersions = row ? kept.get(row.id) ?? [] : [];

            let owner: string | undefined;
            if (row && (byOwner.has(row.ownerOrganizationId) || keptVersions.length > 0)) {
                owner = row.ownerOrganizationId;
            } else {
                const since = owners.get(fqn) ?? new Map<string, number>();
                owner = [...since].sort(([a, aSince], [b, bSince]) => aSince - bSince || (a < b ? -1 : 1))[0]?.[0];
            }
            if (byOwner.size > 1) options.logger?.warn({ fqn, owner, claimants: [...byOwner.keys()] }, 'More than one organization declares the struct');

            const versions = new Map(owner === undefined ? [] : byOwner.get(owner) ?? []);
            if (row && owner === row.ownerOrganizationId) {
                for (const version of keptVersions) if (!versions.has(version.version)) versions.set(version.version, version);
            }

            if (owner === undefined || versions.size === 0) {
                if (row && row.removedAt === null) {
                    await tx.update(structTypesTable).set({ removedAt: now }).where(eq(structTypesTable.id, row.id));
                }
                continue;
            }

            const latest = [...versions.values()].sort((a, b) => compareVersions(b.version, a.version))[0];
            const values = { path: latest.path, name: latest.name, ownerOrganizationId: owner, lastSeenAt: now, removedAt: null };
            let id: number;
            if (row) {
                await tx.update(structTypesTable).set(values).where(eq(structTypesTable.id, row.id));
                id = row.id;
            } else {
                [{ id }] = await tx.insert(structTypesTable).values({ ...values, fqn, firstSeenAt: now }).returning({ id: structTypesTable.id });
            }
            await tx.delete(structTypeVersionsTable).where(eq(structTypeVersionsTable.structTypeId, id));
            await tx.insert(structTypeVersionsTable).values([...versions.values()].map((version) => ({
                structTypeId: id,
                version: version.version,
                fields: version.fields,
                description: version.description,
                baseUrl: version.baseUrl,
                hostNodeId: nodeIds.get(version.baseUrl) ?? null,
                declaredAt: version.declaredAt,
            })));
        }
    });
}
