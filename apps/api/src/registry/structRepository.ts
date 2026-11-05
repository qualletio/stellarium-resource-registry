import type { Page, StructDetail, StructSummary, StructUse, StructVersion } from "@registry/types";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { structTypesTable, structTypeVersionsTable } from "../db/schema.js";
import { compareVersions, escapeLike } from "./registryRepository.js";

export interface StructSearchOptions {
    q?: string;
    offset: number;
    limit: number;
}

const iso = (date: Date | string | null): string | null => (date === null ? null : new Date(date).toISOString());

/** node-postgres and PGlite both return `{ rows }` from `execute`. */
function rowsOf<T>(result: unknown): T[] {
    return (result as { rows: T[] }).rows;
}

type StructVersionRow = typeof structTypeVersionsTable.$inferSelect;

const toStructVersion = (row: StructVersionRow): StructVersion => ({
    version: row.version,
    fields: row.fields,
    description: row.description,
    baseUrl: row.baseUrl,
    declaredAt: iso(row.declaredAt) as string,
});

/**
 * The versions of `fqn` that `text` names, as `fqn@version`: in a type string such as `[]com.example.Address@1`,
 * or anywhere in a contract's source. Every struct reference names its version, so one without isn't counted.
 */
export function structVersionsNamed(text: string, fqn: string): string[] {
    const escaped = fqn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9_.])${escaped}@(\\d+(?:\\.\\d+)*)(?![A-Za-z0-9_])`, 'g');
    return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
}

interface StructSummaryRow {
    fqn: string;
    path: string;
    name: string;
    owner_organization_id: string;
    last_seen_at: Date | string;
    removed_at: Date | string | null;
    version: string;
    fields: { name: string; type: string }[];
    description: string | null;
    version_count: number | string;
}

/** Read queries for structs. Only live ones are searchable. */
export class StructRepository {
    constructor(private readonly db: Database) {}

    async search(options: StructSearchOptions): Promise<Page<StructSummary>> {
        const q = options.q?.trim() ?? '';
        const pattern = `%${escapeLike(q)}%`;
        const prefix = `${escapeLike(q)}%`;

        const conditions = [sql`t.removed_at is null`];
        if (q !== '') {
            conditions.push(sql`(t.fqn ilike ${pattern} or exists (select 1 from jsonb_array_elements(v.fields) f where f->>'name' ilike ${pattern}))`);
        }
        // Exact names first, then prefixes, then substring and field matches.
        const order = q === ''
            ? sql`t.first_seen_at desc, t.fqn asc`
            : sql`case
                when lower(t.fqn) = lower(${q}) or lower(t.name) = lower(${q}) then 0
                when t.name ilike ${prefix} or t.fqn ilike ${prefix} then 1
                when t.fqn ilike ${pattern} then 2
                else 3
              end, t.fqn asc`;

        const rows = rowsOf<StructSummaryRow>(await this.db.execute(sql`
            select t.fqn, t.path, t.name, t.owner_organization_id, t.last_seen_at, t.removed_at,
                   v.version, v.fields, v.description,
                   (select count(*) from struct_type_versions c where c.struct_type_id = t.id) as version_count
            from struct_types t
            cross join lateral (
                -- The latest version, as a node picks it: numerically per dot-separated segment.
                select * from struct_type_versions v
                where v.struct_type_id = t.id
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
                ownerOrganizationId: row.owner_organization_id,
                latestVersion: row.version,
                versionCount: Number(row.version_count),
                fields: row.fields,
                description: row.description,
                matchedFields: q === '' ? [] : row.fields.filter((field) => field.name.toLowerCase().includes(lowered)).map((field) => field.name),
                lastSeenAt: iso(row.last_seen_at) as string,
                removedAt: iso(row.removed_at),
            })),
            nextOffset: rows.length > options.limit ? options.offset + options.limit : null,
        };
    }

    /** A struct by fqn, including one no node lists any more, with what names it. */
    async getStruct(fqn: string): Promise<StructDetail | undefined> {
        const [struct] = await this.db.select().from(structTypesTable).where(eq(structTypesTable.fqn, fqn)).limit(1);
        if (!struct) return undefined;
        const versions = (await this.db.select().from(structTypeVersionsTable).where(eq(structTypeVersionsTable.structTypeId, struct.id)))
            .sort((a, b) => compareVersions(b.version, a.version));
        // A struct is stored with its versions, so it always has one.
        if (versions.length === 0) return undefined;

        return {
            fqn: struct.fqn,
            path: struct.path,
            name: struct.name,
            ownerOrganizationId: struct.ownerOrganizationId,
            latestVersion: versions[0].version,
            versions: versions.map(toStructVersion),
            usedBy: await this.getUses(struct.fqn),
            firstSeenAt: iso(struct.firstSeenAt) as string,
            lastSeenAt: iso(struct.lastSeenAt) as string,
            removedAt: iso(struct.removedAt),
        };
    }

    /**
     * What names the struct: live resources' functions, the latest version of each live contract and event
     * contract, and every version of live event types and structs, since each pins the version it names.
     * Matched with LIKE, then checked by `structVersionsNamed` so a longer name sharing the prefix isn't counted.
     */
    private async getUses(fqn: string): Promise<StructUse[]> {
        const like = `%${escapeLike(fqn)}@%`;
        const uses: StructUse[] = [];
        const add = (text: string, use: Omit<StructUse, 'structVersion'>) => {
            for (const structVersion of structVersionsNamed(text, fqn)) uses.push({ ...use, structVersion });
        };

        // A contract's function describes its latest version, which its source covers below.
        const parameters = rowsOf<{ fqn: string; function: string; name: string; type: string }>(await this.db.execute(sql`
            select r.fqn, f.name as function, p.name, p.type
            from function_parameters p
            join resource_functions f on f.id = p.function_id and f.kind <> 'contract'
            join resources r on r.id = f.resource_id and r.removed_at is null
            where p.type like ${like}
            order by f.position, p.position
        `));
        for (const row of parameters) add(row.type, { kind: 'function', fqn: row.fqn, version: null, function: row.function, member: row.name, role: 'parameter' });
        const returns = rowsOf<{ fqn: string; function: string; return_type: string }>(await this.db.execute(sql`
            select r.fqn, f.name as function, f.return_type
            from resource_functions f
            join resources r on r.id = f.resource_id and r.removed_at is null
            where f.kind <> 'contract' and f.return_type like ${like}
        `));
        for (const row of returns) add(row.return_type, { kind: 'function', fqn: row.fqn, version: null, function: row.function, member: null, role: 'returns' });

        // Every version of each contract that names it in any version; only the latest counts, since calls and events run it.
        const latestSources = async (kind: 'contract' | 'eventContract', query: ReturnType<typeof sql>) => {
            const rows = rowsOf<{ fqn: string; version: string; source: string }>(await this.db.execute(query));
            const latest = new Map<string, { version: string; source: string }>();
            for (const row of rows) {
                const current = latest.get(row.fqn);
                if (!current || compareVersions(row.version, current.version) > 0) latest.set(row.fqn, row);
            }
            for (const [contract, { version, source }] of latest) add(source, { kind, fqn: contract, version, function: null, member: null, role: 'source' });
        };
        await latestSources('contract', sql`
            select r.fqn, v.version, v.source
            from contract_versions v
            join resources r on r.id = v.resource_id and r.removed_at is null
            where exists (select 1 from contract_versions m where m.resource_id = r.id and m.source like ${like})
        `);
        await latestSources('eventContract', sql`
            select c.fqn, v.version, v.source
            from event_contract_versions v
            join event_contracts c on c.id = v.event_contract_id and c.removed_at is null
            where exists (select 1 from event_contract_versions m where m.event_contract_id = c.id and m.source like ${like})
        `);

        const fieldUses = async (kind: 'event' | 'struct', query: ReturnType<typeof sql>) => {
            const rows = rowsOf<{ fqn: string; version: string; fields: { name: string; type: string }[] }>(await this.db.execute(query));
            for (const row of rows) {
                for (const field of row.fields) add(field.type, { kind, fqn: row.fqn, version: row.version, function: null, member: field.name, role: 'field' });
            }
        };
        await fieldUses('event', sql`
            select t.fqn, v.version, v.fields
            from event_type_versions v
            join event_types t on t.id = v.event_type_id and t.removed_at is null
            where v.fields::text like ${like}
        `);
        await fieldUses('struct', sql`
            select t.fqn, v.version, v.fields
            from struct_type_versions v
            join struct_types t on t.id = v.struct_type_id and t.removed_at is null
            where v.fields::text like ${like}
        `);

        const order: StructUse['kind'][] = ['function', 'contract', 'event', 'eventContract', 'struct'];
        return uses.sort((a, b) =>
            order.indexOf(a.kind) - order.indexOf(b.kind)
            || (a.fqn < b.fqn ? -1 : a.fqn > b.fqn ? 1 : 0)
            || compareVersions(b.version ?? '0', a.version ?? '0')
            || (a.function ?? '').localeCompare(b.function ?? '')
            || (a.role === 'returns' ? 1 : 0) - (b.role === 'returns' ? 1 : 0)
            || compareVersions(b.structVersion, a.structVersion));
    }
}
