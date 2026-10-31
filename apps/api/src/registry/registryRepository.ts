import type { ContractInfo, ContractVersion, ContractVersionSummary, NodeInfo, NodeSummary, Page, PaymentManifest, ResourceDetail, ResourceSummary, SearchField, Stats, SyncRun } from "@registry/types";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { contractVersionsTable, functionParametersTable, nodesTable, resourceFunctionsTable, resourcesTable, syncRunsTable } from "../db/schema.js";

export interface SearchOptions {
    q?: string;
    in: SearchField;
    paid: boolean;
    restricted: boolean;
    inference: boolean;
    contract: boolean;
    offset: number;
    limit: number;
}

/** Escapes LIKE wildcards so a query matches literally. */
export function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const iso = (date: Date | string | null): string | null => (date === null ? null : new Date(date).toISOString());

/** node-postgres and PGlite both return `{ rows }` from `execute`. */
function rowsOf<T>(result: unknown): T[] {
    return (result as { rows: T[] }).rows;
}

type NodeRow = typeof nodesTable.$inferSelect;
type SyncRunRow = typeof syncRunsTable.$inferSelect;
type FunctionRow = typeof resourceFunctionsTable.$inferSelect;
type ContractVersionRow = typeof contractVersionsTable.$inferSelect;

/**
 * Orders versions numerically per dot-separated segment ('1.10' > '1.9'), missing segments counting as 0,
 * with the raw string as a tie-break: how a node picks the latest version (`compareVersions` in requestscript).
 */
export function compareVersions(a: string, b: string): number {
    const aSegments = a.split('.');
    const bSegments = b.split('.');
    for (let i = 0; i < Math.max(aSegments.length, bSegments.length); i++) {
        const aValue = BigInt(aSegments[i] ?? '0');
        const bValue = BigInt(bSegments[i] ?? '0');
        if (aValue !== bValue) return aValue < bValue ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

const toContractVersionSummary = (row: ContractVersionRow): ContractVersionSummary => ({
    version: row.version,
    parameters: row.parameters,
    returnType: row.returnType,
    description: row.description,
    deployedAt: iso(row.deployedAt) as string,
});

/** Per-token rates for an inference function, a per-script-token price for a contract, a flat cost for a fixed one. Null for a free function. */
function toPaymentManifest(fn: FunctionRow): PaymentManifest | null {
    if (fn.recipientOrganizationId === null) return null;
    if (fn.kind === 'contract') {
        if (fn.priceMicroUsdPerMillionTokens === null) return null;
        return { priceMicroUsdPerMillionTokens: fn.priceMicroUsdPerMillionTokens, recipientOrganizationId: fn.recipientOrganizationId };
    }
    if (fn.kind === 'inference') {
        if (fn.inputCostMicroUsdPerMillionTokens === null || fn.outputCostMicroUsdPerMillionTokens === null) return null;
        return {
            inputCostMicroUsdPerMillionTokens: fn.inputCostMicroUsdPerMillionTokens,
            outputCostMicroUsdPerMillionTokens: fn.outputCostMicroUsdPerMillionTokens,
            recipientOrganizationId: fn.recipientOrganizationId,
        };
    }
    return fn.costMicroUsd === null ? null : { costMicroUsd: fn.costMicroUsd, recipientOrganizationId: fn.recipientOrganizationId };
}

export function toNodeInfo(node: NodeRow): NodeInfo {
    return {
        baseUrl: node.baseUrl,
        name: node.name,
        publicKey: node.publicKey,
        isSource: node.isSource,
        acceptsGrantRequests: node.acceptsGrantRequests,
        grantEndpoint: node.grantEndpoint,
        grantProbedAt: iso(node.grantProbedAt),
        lastSeenAt: iso(node.lastSeenAt) as string,
    };
}

export function toSyncRun(run: SyncRunRow): SyncRun {
    return {
        id: run.id,
        sourceUrl: run.sourceUrl,
        status: run.status,
        startedAt: iso(run.startedAt) as string,
        finishedAt: iso(run.finishedAt),
        resourcesSeen: run.resourcesSeen,
        resourcesAdded: run.resourcesAdded,
        resourcesRemoved: run.resourcesRemoved,
        error: run.error,
    };
}

interface SummaryRow {
    fqn: string;
    path: string;
    name: string;
    base_url: string;
    description: string | null;
    last_seen_at: Date | string;
    removed_at: Date | string | null;
    function_count: number | string;
    paid_count: number | string;
    per_token_count: number | string;
    restricted_count: number | string;
    inference_count: number | string;
    contract_count: number | string;
    min_cost: number | string | null;
    max_cost: number | string | null;
    matched: string[] | null;
}

/** Read queries behind the public API. Only live (not removed) resources are searchable. */
export class RegistryRepository {
    constructor(private readonly db: Database, private readonly sourceUrl: string) {}

    async search(options: SearchOptions): Promise<Page<ResourceSummary>> {
        const q = options.q?.trim() ?? '';
        const pattern = `%${escapeLike(q)}%`;
        const prefix = `${escapeLike(q)}%`;
        const matchesFunctions = q !== '' && (options.in === 'all' || options.in === 'function');

        const functionMatch = sql`exists (select 1 from resource_functions f where f.resource_id = r.id and f.name ilike ${pattern})`;
        const conditions = [sql`r.removed_at is null`];
        if (q !== '') {
            switch (options.in) {
                case 'path': conditions.push(sql`r.path ilike ${pattern}`); break;
                case 'name': conditions.push(sql`r.name ilike ${pattern}`); break;
                case 'function': conditions.push(functionMatch); break;
                default: conditions.push(sql`(r.fqn ilike ${pattern} or ${functionMatch})`);
            }
        }
        if (options.paid) conditions.push(sql`agg.paid_count > 0`);
        if (options.restricted) conditions.push(sql`agg.restricted_count > 0`);
        if (options.inference) conditions.push(sql`agg.inference_count > 0`);
        if (options.contract) conditions.push(sql`agg.contract_count > 0`);

        // Exact names first, then prefixes, then substring and function-name matches.
        const order = q === ''
            ? sql`r.first_seen_at desc, r.fqn asc`
            : sql`case
                when lower(r.fqn) = lower(${q}) or lower(r.name) = lower(${q}) then 0
                when r.name ilike ${prefix} or r.fqn ilike ${prefix} then 1
                when r.fqn ilike ${pattern} then 2
                else 3
              end, r.fqn asc`;

        const rows = rowsOf<SummaryRow>(await this.db.execute(sql`
            select r.fqn, r.path, r.name, r.base_url, r.description, r.last_seen_at, r.removed_at,
                   agg.function_count, agg.paid_count, agg.per_token_count, agg.restricted_count, agg.inference_count, agg.contract_count,
                   agg.min_cost, agg.max_cost, agg.matched
            from resources r
            cross join lateral (
                select count(*) as function_count,
                       count(f.recipient_organization_id) as paid_count,
                       count(f.input_cost_micro_usd_per_million_tokens) + count(f.price_micro_usd_per_million_tokens) as per_token_count,
                       count(*) filter (where f.restricted) as restricted_count,
                       count(*) filter (where f.kind = 'inference') as inference_count,
                       count(*) filter (where f.kind = 'contract') as contract_count,
                       min(f.cost_micro_usd) as min_cost,
                       max(f.cost_micro_usd) as max_cost,
                       ${matchesFunctions
                           ? sql`array_agg(f.name order by f.position) filter (where f.name ilike ${pattern})`
                           : sql`null::text[]`} as matched
                from resource_functions f
                where f.resource_id = r.id
            ) agg
            where ${sql.join(conditions, sql` and `)}
            order by ${order}
            limit ${options.limit + 1} offset ${options.offset}
        `));

        return {
            items: rows.slice(0, options.limit).map((row) => ({
                fqn: row.fqn,
                path: row.path,
                name: row.name,
                baseUrl: row.base_url,
                description: row.description,
                functionCount: Number(row.function_count),
                matchedFunctions: row.matched ?? [],
                price: row.min_cost === null || row.max_cost === null ? null : { minMicroUsd: Number(row.min_cost), maxMicroUsd: Number(row.max_cost) },
                paidFunctionCount: Number(row.paid_count),
                perTokenFunctionCount: Number(row.per_token_count),
                restrictedFunctionCount: Number(row.restricted_count),
                inferenceFunctionCount: Number(row.inference_count),
                isContract: Number(row.contract_count) > 0,
                lastSeenAt: iso(row.last_seen_at) as string,
                removedAt: iso(row.removed_at),
            })),
            nextOffset: rows.length > options.limit ? options.offset + options.limit : null,
        };
    }

    /** A resource by fqn, including one the source no longer lists. */
    async getResource(fqn: string): Promise<ResourceDetail | undefined> {
        const [row] = await this.db.select()
            .from(resourcesTable)
            .leftJoin(nodesTable, eq(nodesTable.id, resourcesTable.hostNodeId))
            .where(eq(resourcesTable.fqn, fqn))
            .limit(1);
        if (!row) return undefined;
        const resource = row.resources;

        const functions = await this.db.select().from(resourceFunctionsTable)
            .where(eq(resourceFunctionsTable.resourceId, resource.id))
            .orderBy(asc(resourceFunctionsTable.position));
        const parameters = functions.length === 0 ? [] : await this.db.select().from(functionParametersTable)
            .where(inArray(functionParametersTable.functionId, functions.map((fn) => fn.id)))
            .orderBy(asc(functionParametersTable.functionId), asc(functionParametersTable.position));

        return {
            fqn: resource.fqn,
            path: resource.path,
            name: resource.name,
            baseUrl: resource.baseUrl,
            website: resource.website,
            description: resource.description,
            functions: functions.map((fn) => ({
                name: fn.name,
                returnType: fn.returnType,
                description: fn.description,
                parameters: parameters.filter((p) => p.functionId === fn.id).map((p) => ({ name: p.name, type: p.type, description: p.description })),
                paymentManifest: toPaymentManifest(fn),
                restricted: fn.restricted,
                kind: fn.kind,
            })),
            contract: functions.some((fn) => fn.kind === 'contract') ? await this.getContractInfo(resource.id, resource.contractSyncedAt) : null,
            host: row.nodes ? toNodeInfo(row.nodes) : null,
            firstSeenAt: iso(resource.firstSeenAt) as string,
            lastSeenAt: iso(resource.lastSeenAt) as string,
            removedAt: iso(resource.removedAt),
        };
    }

    /** A contract's versions, newest first, and its latest version's source. */
    private async getContractInfo(resourceId: number, syncedAt: Date | null): Promise<ContractInfo> {
        const rows = (await this.db.select().from(contractVersionsTable).where(eq(contractVersionsTable.resourceId, resourceId)))
            .sort((a, b) => compareVersions(b.version, a.version));
        const latest = rows[0];
        return {
            ownerOrganizationId: latest?.ownerOrganizationId ?? null,
            latestVersion: latest?.version ?? null,
            versions: rows.map(toContractVersionSummary),
            source: latest?.source ?? null,
            syncedAt: iso(syncedAt),
        };
    }

    /** One version of a contract, with its source. */
    async getContractVersion(fqn: string, version: string): Promise<ContractVersion | undefined> {
        const [row] = await this.db.select({ version: contractVersionsTable })
            .from(contractVersionsTable)
            .innerJoin(resourcesTable, eq(resourcesTable.id, contractVersionsTable.resourceId))
            .where(and(eq(resourcesTable.fqn, fqn), eq(contractVersionsTable.version, version)))
            .limit(1);
        if (!row) return undefined;
        return { fqn, ...toContractVersionSummary(row.version), source: row.version.source };
    }

    async getNodes(): Promise<NodeSummary[]> {
        const counts = this.db.select({
            hostNodeId: resourcesTable.hostNodeId,
            count: sql<number>`count(*)::int`.as('count'),
        }).from(resourcesTable).where(isNull(resourcesTable.removedAt)).groupBy(resourcesTable.hostNodeId).as('counts');

        const rows = await this.db.select({ node: nodesTable, resourceCount: counts.count })
            .from(nodesTable)
            .leftJoin(counts, eq(counts.hostNodeId, nodesTable.id))
            .orderBy(desc(nodesTable.isSource), asc(nodesTable.baseUrl));
        return rows.map((row) => ({ ...toNodeInfo(row.node), resourceCount: row.resourceCount ?? 0 }));
    }

    async getSyncRuns(limit: number): Promise<SyncRun[]> {
        const runs = await this.db.select().from(syncRunsTable).orderBy(desc(syncRunsTable.id)).limit(limit);
        return runs.map(toSyncRun);
    }

    async getStats(): Promise<Stats> {
        const [counts] = rowsOf<Record<string, number | string>>(await this.db.execute(sql`
            select
                (select count(*) from resources where removed_at is null) as resources,
                count(f.id) as functions,
                count(f.recipient_organization_id) as paid_functions,
                count(*) filter (where f.restricted) as restricted_functions,
                count(*) filter (where f.kind = 'inference') as inference_functions,
                count(*) filter (where f.kind = 'contract') as contracts,
                (select count(*) from nodes) as nodes
            from resource_functions f
            join resources r on r.id = f.resource_id and r.removed_at is null
        `));
        const [lastSync] = await this.db.select().from(syncRunsTable)
            .where(eq(syncRunsTable.status, 'succeeded'))
            .orderBy(desc(syncRunsTable.id))
            .limit(1);

        return {
            resources: Number(counts.resources),
            functions: Number(counts.functions),
            paidFunctions: Number(counts.paid_functions),
            restrictedFunctions: Number(counts.restricted_functions),
            inferenceFunctions: Number(counts.inference_functions),
            contracts: Number(counts.contracts),
            nodes: Number(counts.nodes),
            sourceUrl: this.sourceUrl,
            lastSync: lastSync ? toSyncRun(lastSync) : null,
        };
    }
}
