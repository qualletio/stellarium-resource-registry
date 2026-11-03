import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { eventContractsTable, eventContractVersionsTable, eventTypesTable, eventTypeVersionsTable, nodesTable } from "../db/schema.js";
import type { NodeClient, NodeContract, NodeEventSubscription, NodeEventType } from "../node/nodeClient.js";
import { compareVersions } from "../registry/registryRepository.js";

export interface EventSyncLogger {
    warn(obj: object, msg?: string): void;
}

export interface EventSyncOptions {
    clientFor: (baseUrl: string) => NodeClient;
    /** Runs `task` on every item, a few at a time. */
    forEach: <T>(items: T[], task: (item: T) => Promise<void>) => Promise<void>;
    logger?: EventSyncLogger;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** What one node says about its own events. */
interface NodeEvents {
    /** Each type it declared, by fqn, with each version once. */
    types: Map<string, Map<string, NodeEventType>>;
    /** Each event contract once, by fqn, with its versions. */
    contracts: Map<string, { subscription: NodeEventSubscription; versions: Map<string, NodeContract> }>;
}

const fqnOf = (item: { path: string; name: string }) => `${item.path}.${item.name}`;

/** Reads a node's event types, event contracts and their versions. Null when the node predates events. */
async function readNode(client: NodeClient, logger: EventSyncLogger | undefined): Promise<NodeEvents | null> {
    const [typesResult, subscriptionsResult] = await Promise.all([client.getAllEventTypes(), client.getEventSubscriptions()]);
    if (!typesResult || !subscriptionsResult) return null;
    const host = client.baseUrl;
    if (typesResult.invalid > 0) logger?.warn({ host, invalid: typesResult.invalid }, 'Skipped malformed event types');
    if (subscriptionsResult.invalid > 0) logger?.warn({ host, invalid: subscriptionsResult.invalid }, 'Skipped malformed event contracts');

    // Only the node that declared a type is believed about it. A misbehaving node could repeat a version; the first entry wins.
    const types = new Map<string, Map<string, NodeEventType>>();
    for (const eventType of typesResult.eventTypes) {
        if (eventType.baseUrl !== host) continue;
        const versions = types.get(fqnOf(eventType)) ?? new Map<string, NodeEventType>();
        if (!versions.has(eventType.version)) versions.set(eventType.version, eventType);
        types.set(fqnOf(eventType), versions);
    }

    const contracts: NodeEvents['contracts'] = new Map();
    for (const subscription of subscriptionsResult.subscriptions) {
        if (!contracts.has(fqnOf(subscription))) contracts.set(fqnOf(subscription), { subscription, versions: new Map() });
    }
    if (contracts.size > 0) {
        const { contracts: listed, invalid } = await client.getAllContracts();
        if (invalid > 0) logger?.warn({ host, invalid }, 'Skipped malformed contracts');
        for (const contract of listed) {
            const versions = contracts.get(fqnOf(contract))?.versions;
            if (versions && !versions.has(contract.version)) versions.set(contract.version, contract);
        }
    }
    return { types, contracts };
}

/** The latest of `versions`, as a node picks it. */
function latestOf<T>(versions: Map<string, T>): T | undefined {
    const latest = [...versions.keys()].sort((a, b) => compareVersions(b, a))[0];
    return latest === undefined ? undefined : versions.get(latest);
}

/**
 * Copies one node's event types and event contracts, replacing their versions, and marks those it stopped
 * listing removed. Only the fqns `held` assigns to the node are stored.
 */
async function storeNode(tx: Transaction, node: { id: number; baseUrl: string }, events: NodeEvents, held: Holders) {
    const now = new Date();
    const taken = (kind: keyof Holders, fqn: string) => held[kind].get(fqn) !== node.baseUrl;

    const typeFqns = [...events.types.keys()];
    const existingTypes = new Map((typeFqns.length === 0 ? [] : await tx.select().from(eventTypesTable).where(inArray(eventTypesTable.fqn, typeFqns)))
        .map((row) => [row.fqn, row]));
    const storedTypes: string[] = [];
    for (const [fqn, versions] of events.types) {
        if (taken('types', fqn)) continue;
        const row = existingTypes.get(fqn);
        const latest = latestOf(versions) as NodeEventType;
        const values = {
            path: latest.path,
            name: latest.name,
            baseUrl: node.baseUrl,
            hostNodeId: node.id,
            ownerOrganizationId: latest.ownerOrganizationId,
            lastSeenAt: now,
            removedAt: null,
        };
        let id: number;
        if (row) {
            await tx.update(eventTypesTable).set(values).where(eq(eventTypesTable.id, row.id));
            id = row.id;
        } else {
            [{ id }] = await tx.insert(eventTypesTable).values({ ...values, fqn, firstSeenAt: now }).returning({ id: eventTypesTable.id });
        }
        await tx.delete(eventTypeVersionsTable).where(eq(eventTypeVersionsTable.eventTypeId, id));
        await tx.insert(eventTypeVersionsTable).values([...versions.values()].map((eventType) => ({
            eventTypeId: id,
            version: eventType.version,
            fields: eventType.fields,
            restricted: eventType.restricted,
            description: eventType.description ?? null,
            declaredAt: eventType.createdAt,
        })));
        storedTypes.push(fqn);
    }
    await tx.update(eventTypesTable).set({ removedAt: now }).where(and(
        eq(eventTypesTable.baseUrl, node.baseUrl),
        isNull(eventTypesTable.removedAt),
        storedTypes.length > 0 ? notInArray(eventTypesTable.fqn, storedTypes) : undefined,
    ));

    const contractFqns = [...events.contracts.keys()];
    const existingContracts = new Map((contractFqns.length === 0 ? [] : await tx.select().from(eventContractsTable).where(inArray(eventContractsTable.fqn, contractFqns)))
        .map((row) => [row.fqn, row]));
    const storedContracts: string[] = [];
    for (const [fqn, { subscription, versions }] of events.contracts) {
        if (taken('contracts', fqn)) continue;
        const row = existingContracts.get(fqn);
        const values = {
            path: subscription.path,
            name: subscription.name,
            baseUrl: node.baseUrl,
            hostNodeId: node.id,
            eventFqn: `${subscription.eventPath}.${subscription.eventName}`,
            eventVersion: subscription.eventVersion,
            ownerOrganizationId: subscription.ownerOrganizationId,
            lastSeenAt: now,
            removedAt: null,
        };
        let id: number;
        if (row) {
            await tx.update(eventContractsTable).set(values).where(eq(eventContractsTable.id, row.id));
            id = row.id;
        } else {
            [{ id }] = await tx.insert(eventContractsTable).values({ ...values, fqn, firstSeenAt: now }).returning({ id: eventContractsTable.id });
        }
        await tx.delete(eventContractVersionsTable).where(eq(eventContractVersionsTable.eventContractId, id));
        if (versions.size > 0) {
            await tx.insert(eventContractVersionsTable).values([...versions.values()].map((contract) => ({
                eventContractId: id,
                version: contract.version,
                source: contract.source,
                ownerOrganizationId: contract.ownerOrganizationId,
                description: contract.description ?? null,
                deployedAt: contract.createdAt,
            })));
        }
        storedContracts.push(fqn);
    }
    await tx.update(eventContractsTable).set({ removedAt: now }).where(and(
        eq(eventContractsTable.baseUrl, node.baseUrl),
        isNull(eventContractsTable.removedAt),
        storedContracts.length > 0 ? notInArray(eventContractsTable.fqn, storedContracts) : undefined,
    ));
}

/** Which node holds each event type and event contract fqn. */
interface Holders {
    types: Map<string, string>;
    contracts: Map<string, string>;
}

/**
 * Decides which node holds each fqn more than one node claims. Nodes keep the first declaration of a path, so
 * the registry keeps an fqn with the live node it already has it from, unless that node no longer lists it.
 * Otherwise the earliest declaration wins, then the lower base URL. A node that couldn't be read keeps its own.
 */
async function resolveHolders(db: Database, read: Map<string, NodeEvents | null>, logger: EventSyncLogger | undefined): Promise<Holders> {
    const holders = async (
        kind: 'event type' | 'event contract',
        table: typeof eventTypesTable | typeof eventContractsTable,
        claims: Map<string, { baseUrl: string; since: number }[]>,
    ): Promise<Map<string, string>> => {
        const contested = [...claims].filter(([, claimants]) => claimants.length > 1).map(([fqn]) => fqn);
        const current = new Map((contested.length === 0 ? [] : await db.select({ fqn: table.fqn, baseUrl: table.baseUrl }).from(table)
            .where(and(inArray(table.fqn, contested), isNull(table.removedAt)))).map((row) => [row.fqn, row.baseUrl]));
        const result = new Map<string, string>();
        for (const [fqn, claimants] of claims) {
            const holder = current.get(fqn);
            const chosen = holder !== undefined && (claimants.some((claimant) => claimant.baseUrl === holder) || read.get(holder) === null)
                ? holder
                : [...claimants].sort((a, b) => a.since - b.since || (a.baseUrl < b.baseUrl ? -1 : 1))[0].baseUrl;
            if (claimants.length > 1) logger?.warn({ fqn, holder: chosen, claimants: claimants.map((claimant) => claimant.baseUrl) }, `More than one node lists the ${kind}`);
            result.set(fqn, chosen);
        }
        return result;
    };

    const typeClaims = new Map<string, { baseUrl: string; since: number }[]>();
    const contractClaims = new Map<string, { baseUrl: string; since: number }[]>();
    const claim = (claims: typeof typeClaims, fqn: string, baseUrl: string, dates: Date[]) =>
        claims.set(fqn, [...claims.get(fqn) ?? [], { baseUrl, since: Math.min(...dates.map((date) => date.getTime())) }]);
    for (const [baseUrl, events] of read) {
        for (const [fqn, versions] of events?.types ?? []) claim(typeClaims, fqn, baseUrl, [...versions.values()].map((version) => version.createdAt));
        for (const [fqn, { versions }] of events?.contracts ?? []) claim(contractClaims, fqn, baseUrl, [...versions.values()].map((version) => version.createdAt));
    }
    return { types: await holders('event type', eventTypesTable, typeClaims), contracts: await holders('event contract', eventContractsTable, contractClaims) };
}

/**
 * Reads the event types and event contracts of every node the registry knows, each from its own node. A node
 * that can't be read keeps what was stored before; one that predates events has none. Events of a node the
 * registry no longer knows are marked removed, since nothing would read them again.
 */
export async function syncEvents(db: Database, options: EventSyncOptions): Promise<void> {
    const nodes = await db.select({ id: nodesTable.id, baseUrl: nodesTable.baseUrl }).from(nodesTable);
    const known = nodes.map((node) => node.baseUrl);
    const now = new Date();
    for (const table of [eventTypesTable, eventContractsTable]) {
        await db.update(table).set({ removedAt: now }).where(and(isNull(table.removedAt), known.length > 0 ? notInArray(table.baseUrl, known) : undefined));
    }

    // Null for a node that couldn't be read. A node that predates events has none.
    const read = new Map<string, NodeEvents | null>();
    await options.forEach(nodes, async (node) => {
        try {
            read.set(node.baseUrl, (await readNode(options.clientFor(node.baseUrl), options.logger)) ?? { types: new Map(), contracts: new Map() });
        } catch (error) {
            read.set(node.baseUrl, null);
            options.logger?.warn({ host: node.baseUrl, err: error instanceof Error ? error.message : String(error) }, 'Reading events failed');
        }
    });

    const held = await resolveHolders(db, read, options.logger);
    for (const node of nodes) {
        const events = read.get(node.baseUrl);
        if (events) await db.transaction((tx) => storeNode(tx, node, events, held));
    }
}
