import type { NodeInfo, NodeSummary, Page, ResourceDetail, ResourceSummary, SearchField, Stats, SyncRun } from "@registry/types";
import { asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { functionParametersTable, nodesTable, resourceFunctionsTable, resourcesTable, syncRunsTable } from "../db/schema.js";

export interface SearchOptions {
    q?: string;
    in: SearchField;
    paid: boolean;
    restricted: boolean;
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
    last_seen_at: Date | string;
    removed_at: Date | string | null;
    function_count: number | string;
    paid_count: number | string;
    restricted_count: number | string;
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
            select r.fqn, r.path, r.name, r.base_url, r.last_seen_at, r.removed_at,
                   agg.function_count, agg.paid_count, agg.restricted_count, agg.min_cost, agg.max_cost, agg.matched
            from resources r
            cross join lateral (
                select count(*) as function_count,
                       count(f.cost_lamports) as paid_count,
                       count(*) filter (where f.restricted) as restricted_count,
                       min(f.cost_lamports) as min_cost,
                       max(f.cost_lamports) as max_cost,
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
                functionCount: Number(row.function_count),
                matchedFunctions: row.matched ?? [],
                price: row.min_cost === null || row.max_cost === null ? null : { minLamports: Number(row.min_cost), maxLamports: Number(row.max_cost) },
                paidFunctionCount: Number(row.paid_count),
                restrictedFunctionCount: Number(row.restricted_count),
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
            functions: functions.map((fn) => ({
                name: fn.name,
                returnType: fn.returnType,
                parameters: parameters.filter((p) => p.functionId === fn.id).map((p) => ({ name: p.name, type: p.type })),
                paymentManifest: fn.costLamports === null || fn.recipientAddress === null
                    ? null
                    : { costLamports: fn.costLamports, recipientAddress: fn.recipientAddress },
                restricted: fn.restricted,
            })),
            host: row.nodes ? toNodeInfo(row.nodes) : null,
            firstSeenAt: iso(resource.firstSeenAt) as string,
            lastSeenAt: iso(resource.lastSeenAt) as string,
            removedAt: iso(resource.removedAt),
        };
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
                count(f.cost_lamports) as paid_functions,
                count(*) filter (where f.restricted) as restricted_functions,
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
            nodes: Number(counts.nodes),
            sourceUrl: this.sourceUrl,
            lastSync: lastSync ? toSyncRun(lastSync) : null,
        };
    }
}
