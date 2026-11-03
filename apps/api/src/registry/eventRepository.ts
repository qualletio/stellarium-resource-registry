import type { ContractVersion, EventConsumer, EventContractDetail, EventTypeDetail, EventTypeSummary, EventTypeVersion, Page } from "@registry/types";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { eventContractsTable, eventContractVersionsTable, eventTypesTable, eventTypeVersionsTable, nodesTable } from "../db/schema.js";
import { compareVersions, escapeLike, toNodeInfo } from "./registryRepository.js";

export interface EventSearchOptions {
    q?: string;
    restricted: boolean;
    offset: number;
    limit: number;
}

const iso = (date: Date | string | null): string | null => (date === null ? null : new Date(date).toISOString());

/** node-postgres and PGlite both return `{ rows }` from `execute`. */
function rowsOf<T>(result: unknown): T[] {
    return (result as { rows: T[] }).rows;
}

type EventTypeVersionRow = typeof eventTypeVersionsTable.$inferSelect;
type EventContractVersionRow = typeof eventContractVersionsTable.$inferSelect;

const newestFirst = <T extends { version: string }>(rows: T[]): T[] => [...rows].sort((a, b) => compareVersions(b.version, a.version));

const toEventTypeVersion = (row: EventTypeVersionRow): EventTypeVersion => ({
    version: row.version,
    fields: row.fields,
    restricted: row.restricted,
    description: row.description,
    declaredAt: iso(row.declaredAt) as string,
});

/** An event contract version as a contract version: no parameters, and no return type. */
const toContractVersionSummary = (row: EventContractVersionRow) => ({
    version: row.version,
    parameters: [],
    returnType: '',
    description: row.description,
    deployedAt: iso(row.deployedAt) as string,
});

interface EventSummaryRow {
    fqn: string;
    path: string;
    name: string;
    base_url: string;
    owner_organization_id: string;
    last_seen_at: Date | string;
    removed_at: Date | string | null;
    version: string;
    fields: { name: string; type: string }[];
    restricted: boolean;
    description: string | null;
    consumer_count: number | string;
    matched: string[] | null;
}

/** Read queries for event types and event contracts. Only live ones are searchable. */
export class EventRepository {
    constructor(private readonly db: Database) {}

    async search(options: EventSearchOptions): Promise<Page<EventTypeSummary>> {
        const q = options.q?.trim() ?? '';
        const pattern = `%${escapeLike(q)}%`;
        const prefix = `${escapeLike(q)}%`;

        const consumerMatch = sql`exists (select 1 from event_contracts c where c.event_fqn = t.fqn and c.removed_at is null and c.fqn ilike ${pattern})`;
        const fieldMatch = sql`exists (select 1 from jsonb_array_elements(v.fields) f where f->>'name' ilike ${pattern})`;
        const conditions = [sql`t.removed_at is null`];
        if (q !== '') conditions.push(sql`(t.fqn ilike ${pattern} or ${fieldMatch} or ${consumerMatch})`);
        if (options.restricted) conditions.push(sql`v.restricted`);

        // Exact names first, then prefixes, then substring, field and event contract matches.
        const order = q === ''
            ? sql`t.first_seen_at desc, t.fqn asc`
            : sql`case
                when lower(t.fqn) = lower(${q}) or lower(t.name) = lower(${q}) then 0
                when t.name ilike ${prefix} or t.fqn ilike ${prefix} then 1
                when t.fqn ilike ${pattern} then 2
                else 3
              end, t.fqn asc`;

        const rows = rowsOf<EventSummaryRow>(await this.db.execute(sql`
            select t.fqn, t.path, t.name, t.base_url, t.owner_organization_id, t.last_seen_at, t.removed_at,
                   v.version, v.fields, v.restricted, v.description,
                   (select count(*) from event_contracts c where c.event_fqn = t.fqn and c.removed_at is null) as consumer_count,
                   ${q === ''
                       ? sql`null::text[]`
                       : sql`(select array_agg(c.fqn order by c.fqn) from event_contracts c where c.event_fqn = t.fqn and c.removed_at is null and c.fqn ilike ${pattern})`} as matched
            from event_types t
            cross join lateral (
                -- The latest version, as a node picks it: numerically per dot-separated segment.
                select * from event_type_versions v
                where v.event_type_id = t.id
                order by string_to_array(v.version, '.')::numeric[] desc, v.version desc
                limit 1
            ) v
            where ${sql.join(conditions, sql` and `)}
            order by ${order}
            limit ${options.limit + 1} offset ${options.offset}
        `));

        const lowered = q.toLowerCase();
        return {
            items: rows.slice(0, options.limit).map((row) => ({
                fqn: row.fqn,
                path: row.path,
                name: row.name,
                baseUrl: row.base_url,
                ownerOrganizationId: row.owner_organization_id,
                latestVersion: row.version,
                fields: row.fields,
                restricted: row.restricted,
                description: row.description,
                consumerCount: Number(row.consumer_count),
                matchedConsumers: row.matched ?? [],
                matchedFields: q === '' ? [] : row.fields.filter((field) => field.name.toLowerCase().includes(lowered)).map((field) => field.name),
                lastSeenAt: iso(row.last_seen_at) as string,
                removedAt: iso(row.removed_at),
            })),
            nextOffset: rows.length > options.limit ? options.offset + options.limit : null,
        };
    }

    /** An event type by fqn, including one its node no longer lists, with the live event contracts consuming it. */
    async getEventType(fqn: string): Promise<EventTypeDetail | undefined> {
        const [row] = await this.db.select()
            .from(eventTypesTable)
            .leftJoin(nodesTable, eq(nodesTable.id, eventTypesTable.hostNodeId))
            .where(eq(eventTypesTable.fqn, fqn))
            .limit(1);
        if (!row) return undefined;
        const eventType = row.event_types;
        const versions = newestFirst(await this.db.select().from(eventTypeVersionsTable).where(eq(eventTypeVersionsTable.eventTypeId, eventType.id)));
        // A type is stored with its versions, so it always has one.
        if (versions.length === 0) return undefined;

        return {
            fqn: eventType.fqn,
            path: eventType.path,
            name: eventType.name,
            baseUrl: eventType.baseUrl,
            ownerOrganizationId: eventType.ownerOrganizationId,
            latestVersion: versions[0].version,
            versions: versions.map(toEventTypeVersion),
            consumers: await this.getConsumers(fqn),
            host: row.nodes ? toNodeInfo(row.nodes) : null,
            firstSeenAt: iso(eventType.firstSeenAt) as string,
            lastSeenAt: iso(eventType.lastSeenAt) as string,
            removedAt: iso(eventType.removedAt),
        };
    }

    private async getConsumers(eventFqn: string): Promise<EventConsumer[]> {
        const contracts = await this.db.select().from(eventContractsTable)
            .where(and(eq(eventContractsTable.eventFqn, eventFqn), isNull(eventContractsTable.removedAt)))
            .orderBy(eventContractsTable.fqn);
        const versions = contracts.length === 0 ? [] : await this.db.select().from(eventContractVersionsTable)
            .where(inArray(eventContractVersionsTable.eventContractId, contracts.map((contract) => contract.id)));
        return contracts.map((contract) => {
            const latest = newestFirst(versions.filter((version) => version.eventContractId === contract.id))[0];
            return {
                fqn: contract.fqn,
                path: contract.path,
                name: contract.name,
                baseUrl: contract.baseUrl,
                eventVersion: contract.eventVersion,
                ownerOrganizationId: contract.ownerOrganizationId,
                description: latest?.description ?? null,
                latestVersion: latest?.version ?? null,
            };
        });
    }

    /** An event contract by fqn, including one its node no longer lists. */
    async getEventContract(fqn: string): Promise<EventContractDetail | undefined> {
        const [row] = await this.db.select()
            .from(eventContractsTable)
            .leftJoin(nodesTable, eq(nodesTable.id, eventContractsTable.hostNodeId))
            .where(eq(eventContractsTable.fqn, fqn))
            .limit(1);
        if (!row) return undefined;
        const contract = row.event_contracts;
        const versions = newestFirst(await this.db.select().from(eventContractVersionsTable).where(eq(eventContractVersionsTable.eventContractId, contract.id)));
        const latest = versions[0];
        const [eventType] = await this.db.select({ id: eventTypesTable.id }).from(eventTypesTable)
            .where(and(eq(eventTypesTable.fqn, contract.eventFqn), isNull(eventTypesTable.removedAt)))
            .limit(1);

        return {
            fqn: contract.fqn,
            path: contract.path,
            name: contract.name,
            baseUrl: contract.baseUrl,
            description: latest?.description ?? null,
            consumes: { fqn: contract.eventFqn, version: contract.eventVersion, known: eventType !== undefined },
            contract: {
                ownerOrganizationId: contract.ownerOrganizationId ?? latest?.ownerOrganizationId ?? null,
                latestVersion: latest?.version ?? null,
                versions: versions.map(toContractVersionSummary),
                source: latest?.source ?? null,
                // Stamped each time the registry reads the node's events.
                syncedAt: iso(contract.lastSeenAt),
            },
            host: row.nodes ? toNodeInfo(row.nodes) : null,
            firstSeenAt: iso(contract.firstSeenAt) as string,
            lastSeenAt: iso(contract.lastSeenAt) as string,
            removedAt: iso(contract.removedAt),
        };
    }

    /** One version of an event contract, with its source. */
    async getEventContractVersion(fqn: string, version: string): Promise<ContractVersion | undefined> {
        const [row] = await this.db.select({ version: eventContractVersionsTable })
            .from(eventContractVersionsTable)
            .innerJoin(eventContractsTable, eq(eventContractsTable.id, eventContractVersionsTable.eventContractId))
            .where(and(eq(eventContractsTable.fqn, fqn), eq(eventContractVersionsTable.version, version)))
            .limit(1);
        if (!row) return undefined;
        return { fqn, ...toContractVersionSummary(row.version), source: row.version.source };
    }
}
