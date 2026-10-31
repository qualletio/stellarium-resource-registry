import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { contractVersionsTable, functionParametersTable, nodesTable, resourceFunctionsTable, resourcesTable, syncRunsTable } from "../db/schema.js";
import { NodeClient, type NodeContract, type NodePaymentManifest, type NodePeer, type NodeResource } from "../node/nodeClient.js";

export type SyncRunRow = typeof syncRunsTable.$inferSelect;

export interface SyncLogger {
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
}

export interface SyncServiceOptions {
    sourceUrl: string;
    grantProbeIntervalMs: number;
    /** How many hosts are probed for grant support, or read for contracts, at once. */
    probeConcurrency?: number;
    /** Builds the client for a node's base URL. Tests swap the transport. */
    clientFor?: (baseUrl: string) => NodeClient;
    logger?: SyncLogger;
}

/** Changes whenever a function, parameter, description, price, restriction or kind changes. Key order is fixed by `NodeResource`. */
export function functionsHash(resource: NodeResource): string {
    return createHash('sha256').update(JSON.stringify(resource.functions)).digest('hex');
}

/** A function's paymentManifest as `resource_functions` columns, all null for a free function. */
function manifestColumns(manifest: NodePaymentManifest | undefined) {
    return {
        costMicroUsd: manifest && 'costMicroUsd' in manifest ? manifest.costMicroUsd : null,
        inputCostMicroUsdPerMillionTokens: manifest && 'inputCostMicroUsdPerMillionTokens' in manifest ? manifest.inputCostMicroUsdPerMillionTokens : null,
        outputCostMicroUsdPerMillionTokens: manifest && 'outputCostMicroUsdPerMillionTokens' in manifest ? manifest.outputCostMicroUsdPerMillionTokens : null,
        priceMicroUsdPerMillionTokens: manifest && 'priceMicroUsdPerMillionTokens' in manifest ? manifest.priceMicroUsdPerMillionTokens : null,
        recipientOrganizationId: manifest?.recipientOrganizationId ?? null,
    };
}

/** Runs kept in `sync_runs`. One run every two hours adds 12 rows a day. */
const KEPT_SYNC_RUNS = 1_000;

const fqnOf = (resource: { path: string; name: string }) => `${resource.path}.${resource.name}`;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Runs `task` on every item, `concurrency` at a time. */
async function forEachConcurrently<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const worker = async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item);
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
}

/**
 * Copies the source node's resource list into Postgres. A resource the node stops listing is
 * marked removed rather than deleted. Restricted functions' hosts are probed for grant support,
 * and contracts' hosts are read for each contract's versions and source.
 */
export class SyncService {
    private readonly clientFor: (baseUrl: string) => NodeClient;
    private running: Promise<SyncRunRow> | undefined;
    /** Settable after construction, so the server can hand over Fastify's logger once the app exists. */
    logger: SyncLogger | undefined;

    constructor(private readonly db: Database, private readonly options: SyncServiceOptions) {
        this.clientFor = options.clientFor ?? ((baseUrl) => new NodeClient(baseUrl));
        this.logger = options.logger;
    }

    /** Runs one sync, or joins the one already running. */
    sync(): Promise<SyncRunRow> {
        if (!this.running) {
            this.running = this.runSync().finally(() => {
                this.running = undefined;
            });
        }
        return this.running;
    }

    get isRunning(): boolean {
        return this.running !== undefined;
    }

    private async runSync(): Promise<SyncRunRow> {
        const [run] = await this.db.insert(syncRunsTable).values({ sourceUrl: this.options.sourceUrl }).returning();
        try {
            const source = this.clientFor(this.options.sourceUrl);
            const [self, { resources, invalid }, peers] = await Promise.all([source.getSelf(), source.getAllResources(), source.getAllPeers()]);
            if (invalid > 0) {
                this.logger?.warn({ invalid }, 'Skipped malformed resources from the source node');
            }

            const counts = await this.db.transaction((tx) => this.store(tx, self, peers, resources));
            await Promise.all([this.probeGrants(), this.syncContracts()]);

            const [finished] = await this.db.update(syncRunsTable)
                .set({ status: 'succeeded', finishedAt: new Date(), ...counts })
                .where(eq(syncRunsTable.id, run.id))
                .returning();
            this.logger?.info(counts, 'Synced resources');
            await this.db.delete(syncRunsTable).where(lt(syncRunsTable.id, run.id - KEPT_SYNC_RUNS + 1));
            return finished;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const [failed] = await this.db.update(syncRunsTable)
                .set({ status: 'failed', finishedAt: new Date(), error: message })
                .where(eq(syncRunsTable.id, run.id))
                .returning();
            this.logger?.warn({ err: message }, 'Sync failed');
            return failed;
        }
    }

    private async store(tx: Transaction, self: NodePeer, peers: NodePeer[], listed: NodeResource[]) {
        const now = new Date();

        // A node lists each fqn once, but a misbehaving one could repeat it. The first entry wins.
        const resources = new Map<string, NodeResource>();
        for (const resource of listed) {
            if (!resources.has(fqnOf(resource))) resources.set(fqnOf(resource), resource);
        }

        await tx.update(nodesTable).set({ isSource: false }).where(eq(nodesTable.isSource, true));
        await this.upsertNode(tx, self, now, true);
        for (const peer of peers) {
            if (peer.baseUrl !== self.baseUrl) await this.upsertNode(tx, peer, now, false);
        }
        // Hosts the source lists resources for but not as peers. Their identity is unknown.
        const hostUrls = [...new Set([...resources.values()].map((resource) => resource.baseUrl))];
        if (hostUrls.length > 0) {
            await tx.insert(nodesTable).values(hostUrls.map((baseUrl) => ({ baseUrl, lastSeenAt: now })))
                .onConflictDoUpdate({ target: nodesTable.baseUrl, set: { lastSeenAt: now } });
        }
        const nodeIds = new Map(
            (hostUrls.length > 0 ? await tx.select({ id: nodesTable.id, baseUrl: nodesTable.baseUrl }).from(nodesTable).where(inArray(nodesTable.baseUrl, hostUrls)) : [])
                .map((node) => [node.baseUrl, node.id]),
        );

        const existing = new Map(
            (await tx.select({ id: resourcesTable.id, fqn: resourcesTable.fqn, functionsHash: resourcesTable.functionsHash, removedAt: resourcesTable.removedAt }).from(resourcesTable))
                .map((row) => [row.fqn, row]),
        );

        let resourcesAdded = 0;
        for (const [fqn, resource] of resources) {
            const hash = functionsHash(resource);
            const values = {
                path: resource.path,
                name: resource.name,
                baseUrl: resource.baseUrl,
                website: resource.website ?? null,
                description: resource.description ?? null,
                hostNodeId: nodeIds.get(resource.baseUrl) ?? null,
                functionsHash: hash,
                lastSeenAt: now,
                removedAt: null,
            };
            const row = existing.get(fqn);
            if (!row) {
                const [inserted] = await tx.insert(resourcesTable).values({ ...values, fqn, firstSeenAt: now }).returning({ id: resourcesTable.id });
                await this.insertFunctions(tx, inserted.id, resource);
                resourcesAdded++;
                continue;
            }
            if (row.removedAt) resourcesAdded++;
            await tx.update(resourcesTable).set(values).where(eq(resourcesTable.id, row.id));
            if (row.functionsHash !== hash) {
                await tx.delete(resourceFunctionsTable).where(eq(resourceFunctionsTable.resourceId, row.id));
                await this.insertFunctions(tx, row.id, resource);
            }
        }

        const seen = [...resources.keys()];
        const removed = await tx.update(resourcesTable)
            .set({ removedAt: now })
            .where(and(isNull(resourcesTable.removedAt), seen.length > 0 ? notInArray(resourcesTable.fqn, seen) : undefined))
            .returning({ id: resourcesTable.id });

        // Every node the source still lists was stamped with `now` above. Others are dropped once
        // no live resource points at them; removed resources keep their row, without a host.
        await tx.delete(nodesTable).where(and(
            lt(nodesTable.lastSeenAt, now),
            sql`not exists (select 1 from ${resourcesTable} where ${resourcesTable.hostNodeId} = ${nodesTable.id} and ${resourcesTable.removedAt} is null)`,
        ));

        return { resourcesSeen: resources.size, resourcesAdded, resourcesRemoved: removed.length };
    }

    private async upsertNode(tx: Transaction, node: NodePeer, now: Date, isSource: boolean) {
        const values = { name: node.name, publicKey: node.publicKey, lastSeenAt: now, ...(isSource ? { isSource } : {}) };
        await tx.insert(nodesTable).values({ baseUrl: node.baseUrl, ...values })
            .onConflictDoUpdate({ target: nodesTable.baseUrl, set: values });
    }

    private async insertFunctions(tx: Transaction, resourceId: number, resource: NodeResource) {
        if (resource.functions.length === 0) return;
        const inserted = await tx.insert(resourceFunctionsTable).values(resource.functions.map((fn, position) => ({
            resourceId,
            name: fn.name,
            returnType: fn.returnType,
            description: fn.description ?? null,
            restricted: fn.restricted,
            kind: fn.kind,
            ...manifestColumns(fn.paymentManifest),
            position,
        }))).returning({ id: resourceFunctionsTable.id, name: resourceFunctionsTable.name });

        const idByName = new Map(inserted.map((row) => [row.name, row.id]));
        const parameters = resource.functions.flatMap((fn) => fn.parameters.map((parameter, position) => ({
            functionId: idByName.get(fn.name) as number,
            name: parameter.name,
            type: parameter.type,
            description: parameter.description ?? null,
            position,
        })));
        if (parameters.length > 0) {
            await tx.insert(functionParametersTable).values(parameters);
        }
    }

    /**
     * For each host with a live restricted function that hasn't been probed recently, calls one
     * of its restricted functions without authorization. The 403 says whether the host issues
     * grants on request. Other outcomes (unreachable, rate limited) leave the stored answer alone.
     */
    private async probeGrants(): Promise<void> {
        const staleBefore = new Date(Date.now() - this.options.grantProbeIntervalMs);
        const targets = await this.db.selectDistinctOn([nodesTable.id], {
            nodeId: nodesTable.id,
            baseUrl: nodesTable.baseUrl,
            resourcePath: resourcesTable.path,
            resourceName: resourcesTable.name,
            functionName: resourceFunctionsTable.name,
        })
            .from(nodesTable)
            .innerJoin(resourcesTable, eq(resourcesTable.hostNodeId, nodesTable.id))
            .innerJoin(resourceFunctionsTable, eq(resourceFunctionsTable.resourceId, resourcesTable.id))
            .where(and(
                eq(resourceFunctionsTable.restricted, true),
                isNull(resourcesTable.removedAt),
                or(isNull(nodesTable.grantProbedAt), lt(nodesTable.grantProbedAt, staleBefore)),
            ))
            .orderBy(nodesTable.id, desc(resourcesTable.lastSeenAt));

        await forEachConcurrently(targets, this.options.probeConcurrency ?? 4, async (target) => {
            try {
                const result = await this.clientFor(target.baseUrl).probeGrant(target.resourcePath, target.resourceName, target.functionName);
                if (result.kind !== 'restricted') {
                    this.logger?.warn({ host: target.baseUrl, status: result.status }, 'Unexpected grant probe response');
                    return;
                }
                await this.db.update(nodesTable).set({
                    acceptsGrantRequests: result.grantEndpoint !== null,
                    grantEndpoint: result.grantEndpoint,
                    grantProbedAt: new Date(),
                }).where(eq(nodesTable.id, target.nodeId));
            } catch (error) {
                this.logger?.warn({ host: target.baseUrl, err: error instanceof Error ? error.message : String(error) }, 'Grant probe failed');
            }
        });
    }

    /**
     * Reads every version of each live contract, with its source, from the node that hosts it: the source
     * node only lists a contract's latest signature, and peers' contracts only on their own nodes. Only a
     * contract's own host is believed about it. A host that can't be read keeps the versions stored before.
     */
    private async syncContracts(): Promise<void> {
        const rows = await this.db.selectDistinct({ id: resourcesTable.id, fqn: resourcesTable.fqn, baseUrl: resourcesTable.baseUrl })
            .from(resourcesTable)
            .innerJoin(resourceFunctionsTable, eq(resourceFunctionsTable.resourceId, resourcesTable.id))
            .where(and(eq(resourceFunctionsTable.kind, 'contract'), isNull(resourcesTable.removedAt)));

        const byHost = new Map<string, Map<string, number>>();
        for (const row of rows) {
            const contracts = byHost.get(row.baseUrl) ?? new Map<string, number>();
            contracts.set(row.fqn, row.id);
            byHost.set(row.baseUrl, contracts);
        }

        await forEachConcurrently([...byHost], this.options.probeConcurrency ?? 4, async ([host, resourceIds]) => {
            let listed: NodeContract[];
            try {
                const { contracts, invalid } = await this.clientFor(host).getAllContracts();
                if (invalid > 0) this.logger?.warn({ host, invalid }, 'Skipped malformed contracts');
                listed = contracts;
            } catch (error) {
                this.logger?.warn({ host, err: error instanceof Error ? error.message : String(error) }, 'Reading contracts failed');
                return;
            }

            // Each version once. A misbehaving node could repeat one; the first entry wins.
            const versions = new Map<number, Map<string, NodeContract>>([...resourceIds.values()].map((id) => [id, new Map()]));
            for (const contract of listed) {
                const resourceId = resourceIds.get(fqnOf(contract));
                const forResource = resourceId === undefined ? undefined : versions.get(resourceId);
                if (forResource && !forResource.has(contract.version)) forResource.set(contract.version, contract);
            }

            const now = new Date();
            await this.db.transaction(async (tx) => {
                for (const [resourceId, contracts] of versions) {
                    await tx.delete(contractVersionsTable).where(eq(contractVersionsTable.resourceId, resourceId));
                    if (contracts.size > 0) {
                        await tx.insert(contractVersionsTable).values([...contracts.values()].map((contract) => ({
                            resourceId,
                            version: contract.version,
                            source: contract.source,
                            parameters: contract.parameters,
                            returnType: contract.returnType,
                            ownerOrganizationId: contract.ownerOrganizationId,
                            description: contract.description ?? null,
                            deployedAt: contract.createdAt,
                        })));
                    }
                    await tx.update(resourcesTable).set({ contractSyncedAt: now }).where(eq(resourcesTable.id, resourceId));
                }
            });
        });
    }
}
