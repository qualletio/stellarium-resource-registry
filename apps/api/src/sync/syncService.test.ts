import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/database.js';
import { contractVersionsTable, nodesTable, resourceFunctionsTable, resourcesTable } from '../db/schema.js';
import {
    described,
    freePort,
    open,
    PEER_CONTRACTS,
    PEER_RESOURCES,
    paid,
    type RunningNode,
    restricted,
    SAMPLE_CONTRACT_PRICE,
    SAMPLE_ORGANIZATION,
    SOURCE_CONTRACTS,
    SOURCE_RESOURCES,
    type StartNodeOptions,
    startNode,
} from '@registry/node-fixtures';
import { NodeClient } from '../node/nodeClient.js';
import { RegistryRepository } from '../registry/registryRepository.js';
import { createTestDatabase } from '../testing.js';
import { SyncService } from './syncService.js';

const weather = { path: 'com.example', name: 'Weather', functions: [paid('temperature', 'city: string', 'int32', 10_000), open('stations', '', 'string')] };
const ledger = { path: 'io.example', name: 'Ledger', functions: [open('rates', '', 'string'), restricted(open('balance', 'account: string', 'int64'))] };

describe('SyncService against a real stellarium-ts node', () => {
    let db: Database;
    let close: () => Promise<void>;
    let port: number;
    let sourceUrl: string;
    let nodes: RunningNode[];
    let repository: RegistryRepository;
    let service: SyncService;

    /** (Re)starts the source node on its fixed port, so the registry sees the same node change. */
    const startSource = async (options: Omit<StartNodeOptions, 'port'>) => {
        await Promise.all(nodes.map((node) => node.close()));
        const node = await startNode({ approveGrants: true, ...options, port });
        nodes = [node];
        return node;
    };

    beforeEach(async () => {
        ({ db, close } = await createTestDatabase());
        nodes = [];
        port = await freePort();
        sourceUrl = `http://127.0.0.1:${port}`;
        repository = new RegistryRepository(db, sourceUrl);
        service = new SyncService(db, { sourceUrl, grantProbeIntervalMs: 60_000 });
    });

    afterEach(async () => {
        await Promise.all(nodes.map((node) => node.close()));
        await close();
    });

    it('stores every resource with its functions, parameters, prices and restrictions', async () => {
        const node = await startSource({ resources: SOURCE_RESOURCES });
        const run = await service.sync();
        expect(run).toMatchObject({ status: 'succeeded', resourcesSeen: 5, resourcesAdded: 5, resourcesRemoved: 0 });

        const detail = await repository.getResource('io.quallet.finance.Ledger');
        expect(detail?.functions).toEqual([
            {
                name: 'balance',
                returnType: 'int64',
                description: 'The account\'s balance, in lamports.',
                parameters: [{ name: 'account', type: 'string', description: 'The account ID.' }],
                paymentManifest: null,
                restricted: true,
                kind: 'fixed',
            },
            {
                name: 'transfer',
                returnType: 'boolean',
                description: 'Moves funds between two accounts. Returns false when the balance is too low.',
                parameters: [
                    { name: 'from', type: 'string', description: 'The account to debit.' },
                    { name: 'to', type: 'string', description: 'The account to credit.' },
                    { name: 'amount', type: 'int64', description: 'How much to move, in lamports.' },
                ],
                paymentManifest: { costMicroUsd: 5_000, recipientOrganizationId: SAMPLE_ORGANIZATION },
                restricted: true,
                kind: 'fixed',
            },
            { name: 'rates', returnType: 'string', description: 'Current exchange rates as JSON.', parameters: [], paymentManifest: null, restricted: false, kind: 'fixed' },
        ]);
        expect(detail).toMatchObject({
            website: 'https://ledger.example.com',
            description: 'Account balances and transfers. Balance and transfer calls need a grant.',
        });
        expect(detail?.host).toMatchObject({ baseUrl: node.baseUrl, publicKey: node.publicKey, isSource: true });

        const assistant = await repository.getResource('ai.example.Assistant');
        expect(assistant?.functions).toMatchObject([
            {
                name: 'complete',
                kind: 'inference',
                parameters: [{ name: 'prompt' }, { name: 'maxTokens', type: 'int32', description: 'The most output tokens to generate.' }],
                paymentManifest: { inputCostMicroUsdPerMillionTokens: 3_000_000, outputCostMicroUsdPerMillionTokens: 15_000_000, recipientOrganizationId: SAMPLE_ORGANIZATION },
            },
            { name: 'summarize', kind: 'inference', paymentManifest: null },
        ]);
    });

    it('marks resources the node stops listing as removed, and restores them when listed again', async () => {
        await startSource({ resources: [weather, ledger] });
        await service.sync();

        await startSource({ resources: [weather] });
        expect(await service.sync()).toMatchObject({ resourcesSeen: 1, resourcesAdded: 0, resourcesRemoved: 1 });
        expect((await repository.getResource('io.example.Ledger'))?.removedAt).not.toBeNull();
        const live = await repository.search({ in: 'all', paid: false, restricted: false, inference: false, contract: false, offset: 0, limit: 10 });
        expect(live.items.map((r) => r.fqn)).toEqual(['com.example.Weather']);

        await startSource({ resources: [weather, ledger] });
        expect(await service.sync()).toMatchObject({ resourcesAdded: 1, resourcesRemoved: 0 });
        expect((await repository.getResource('io.example.Ledger'))?.removedAt).toBeNull();
    });

    it('rewrites functions only when they change', async () => {
        await startSource({ resources: [weather, ledger] });
        await service.sync();
        const before = await db.select({ id: resourceFunctionsTable.id }).from(resourceFunctionsTable);
        await service.sync();
        expect(await db.select({ id: resourceFunctionsTable.id }).from(resourceFunctionsTable)).toEqual(before);

        await startSource({ resources: [{ ...weather, functions: [paid('temperature', 'city: string', 'int32', 20_000)] }, ledger] });
        await service.sync();
        const detail = await repository.getResource('com.example.Weather');
        expect(detail?.functions.map((fn) => [fn.name, fn.paymentManifest])).toEqual([['temperature', { costMicroUsd: 20_000, recipientOrganizationId: SAMPLE_ORGANIZATION }]]);
    });

    it('updates descriptions and websites when the node changes them', async () => {
        await startSource({ resources: [weather] });
        await service.sync();
        expect(await repository.getResource('com.example.Weather')).toMatchObject({ website: null, description: null });

        const temperature = described(weather.functions[0], 'Degrees Celsius', { city: 'A city name' });
        await startSource({ resources: [{ ...weather, website: 'https://weather.example', description: 'Forecasts', functions: [temperature, weather.functions[1]] }] });
        await service.sync();
        const detail = await repository.getResource('com.example.Weather');
        expect(detail).toMatchObject({ website: 'https://weather.example', description: 'Forecasts' });
        expect(detail?.functions[0]).toMatchObject({ description: 'Degrees Celsius', parameters: [{ name: 'city', description: 'A city name' }] });
        expect((await repository.search({ in: 'all', paid: false, restricted: false, inference: false, contract: false, offset: 0, limit: 10 })).items[0].description).toBe('Forecasts');

        await startSource({ resources: [weather] });
        await service.sync();
        const cleared = await repository.getResource('com.example.Weather');
        expect(cleared).toMatchObject({ website: null, description: null });
        expect(cleared?.functions[0]).toMatchObject({ description: null, parameters: [{ name: 'city', description: null }] });
    });

    it('learns grant support from restricted functions without running any function', async () => {
        const node = await startSource({ resources: SOURCE_RESOURCES });
        await service.sync();
        const [host] = await db.select().from(nodesTable).where(eq(nodesTable.baseUrl, node.baseUrl));
        expect(host).toMatchObject({ acceptsGrantRequests: true, grantEndpoint: `${node.baseUrl}/v1/grants/request` });
        expect(host.grantProbedAt).not.toBeNull();
        expect(node.executed).toEqual([]);
    });

    it('records a host that refuses grant requests, and re-probes only after the interval', async () => {
        await startSource({ resources: [ledger], approveGrants: false });
        await service.sync();
        const [first] = await db.select().from(nodesTable).where(eq(nodesTable.baseUrl, sourceUrl));
        expect(first).toMatchObject({ acceptsGrantRequests: false, grantEndpoint: null });

        await startSource({ resources: [ledger], approveGrants: true });
        await service.sync();
        const [second] = await db.select().from(nodesTable).where(eq(nodesTable.baseUrl, sourceUrl));
        expect(second.acceptsGrantRequests).toBe(false);
        expect(second.grantProbedAt).toEqual(first.grantProbedAt);
    });

    it('stores peers and the resources the source learned from them, probing each host', async () => {
        const peer = await startNode({ resources: PEER_RESOURCES });
        const source = await startNode({ resources: SOURCE_RESOURCES, approveGrants: true, startingPeer: peer.baseUrl, port });
        nodes = [peer, source];

        expect(await service.sync()).toMatchObject({ status: 'succeeded', resourcesSeen: 7 });
        const library = await repository.getResource('org.archive.Library');
        expect(library?.baseUrl).toBe(peer.baseUrl);
        // Learned through the source, so the kind and per-token rates survive the peer broadcast.
        expect(library?.functions.find((fn) => fn.name === 'ask')).toMatchObject({
            kind: 'inference',
            restricted: true,
            paymentManifest: { inputCostMicroUsdPerMillionTokens: 1_000_000, outputCostMicroUsdPerMillionTokens: 0, recipientOrganizationId: SAMPLE_ORGANIZATION },
        });

        const byUrl = new Map((await repository.getNodes()).map((node) => [node.baseUrl, node]));
        expect(byUrl.get(source.baseUrl)).toMatchObject({ isSource: true, resourceCount: 5, acceptsGrantRequests: true });
        expect(byUrl.get(peer.baseUrl)).toMatchObject({ isSource: false, resourceCount: 2, publicKey: peer.publicKey, acceptsGrantRequests: false });
        expect([...source.executed, ...peer.executed]).toEqual([]);
    });

    it('drops nodes the source stops listing once they host no live resources', async () => {
        const peer = await startNode({ resources: PEER_RESOURCES });
        nodes = [peer, await startNode({ resources: [weather], startingPeer: peer.baseUrl, port })];
        await service.sync();
        expect((await repository.getNodes()).map((node) => node.baseUrl)).toContain(peer.baseUrl);

        await startSource({ resources: [weather] });
        await service.sync();
        expect((await repository.getNodes()).map((node) => node.baseUrl)).toEqual([sourceUrl]);
        const archived = await repository.getResource('org.archive.Library');
        expect(archived).toMatchObject({ host: null });
        expect(archived?.removedAt).not.toBeNull();
    });

    it('records a failed run when the node is unreachable, and keeps what it had', async () => {
        await startSource({ resources: [weather, ledger] });
        await service.sync();
        await Promise.all(nodes.map((node) => node.close()));
        nodes = [];

        const run = await service.sync();
        expect(run.status).toBe('failed');
        expect(run.error).toMatch(/failed/);
        expect(await db.select({ fqn: resourcesTable.fqn }).from(resourcesTable).where(eq(resourcesTable.fqn, 'io.example.Ledger'))).toHaveLength(1);
        expect((await repository.getResource('io.example.Ledger'))?.removedAt).toBeNull();
    });

    it('reads each contract\'s versions and source from its own host, whether the source or a peer', async () => {
        const peer = await startNode({ resources: PEER_RESOURCES, contracts: PEER_CONTRACTS });
        const source = await startNode({ resources: SOURCE_RESOURCES, contracts: SOURCE_CONTRACTS, approveGrants: true, startingPeer: peer.baseUrl, port });
        nodes = [peer, source];

        expect(await service.sync()).toMatchObject({ status: 'succeeded', resourcesSeen: 9 });
        const outlook = await repository.getResource('com.example.Outlook');
        expect(outlook?.functions).toMatchObject([{
            name: 'run',
            kind: 'contract',
            parameters: [{ name: 'city', type: 'string' }, { name: 'days', type: 'int32' }],
            paymentManifest: { priceMicroUsdPerMillionTokens: SAMPLE_CONTRACT_PRICE, recipientOrganizationId: SAMPLE_ORGANIZATION },
        }]);
        expect(outlook?.contract).toMatchObject({ latestVersion: '2', source: SOURCE_CONTRACTS[1].source, ownerOrganizationId: null });
        expect(outlook?.contract?.versions.map((v) => [v.version, v.description])).toEqual([
            ['2', SOURCE_CONTRACTS[1].description],
            ['1', SOURCE_CONTRACTS[0].description],
        ]);

        // The source only lists the peer's contract. Its versions come from the peer.
        const visits = await repository.getResource('org.archive.Visits');
        expect(visits?.baseUrl).toBe(peer.baseUrl);
        expect(visits?.contract).toMatchObject({ latestVersion: '1', source: PEER_CONTRACTS[0].source });
        expect((await repository.getStats()).contracts).toBe(2);
        expect((await repository.search({ in: 'all', paid: false, restricted: false, inference: false, contract: true, offset: 0, limit: 10 })).items.map((r) => r.fqn))
            .toEqual(['com.example.Outlook', 'org.archive.Visits']);
        expect([...source.executed, ...peer.executed]).toEqual([]);
    });

    it('follows versions the host deletes, and marks a contract removed once it is gone', async () => {
        const node = await startSource({ resources: [weather], contracts: SOURCE_CONTRACTS });
        await service.sync();
        await node.deleteContract('com.example.Outlook@2');
        await service.sync();
        const outlook = await repository.getResource('com.example.Outlook');
        expect(outlook?.contract?.versions.map((v) => v.version)).toEqual(['1']);
        expect(outlook?.functions[0].parameters.map((p) => p.name)).toEqual(['city']);

        await node.deleteContract('com.example.Outlook');
        expect(await service.sync()).toMatchObject({ resourcesRemoved: 1 });
        const removed = await repository.getResource('com.example.Outlook');
        expect(removed?.removedAt).not.toBeNull();
        // Kept, like a removed resource's functions, so the page still shows what it ran.
        expect(removed?.contract?.latestVersion).toBe('1');
    });

    it('keeps a contract\'s stored versions when its host can\'t be read', async () => {
        let failing = false;
        const node = await startSource({ resources: [weather], contracts: SOURCE_CONTRACTS });
        service = new SyncService(db, {
            sourceUrl,
            grantProbeIntervalMs: 60_000,
            clientFor: (baseUrl) => new NodeClient(baseUrl, 10_000, async (input, init) =>
                failing && String(input).includes('/v1/contracts') ? new Response('{}', { status: 503 }) : fetch(input, init)),
        });
        await service.sync();
        const syncedAt = (await repository.getResource('com.example.Outlook'))?.contract?.syncedAt;

        failing = true;
        await node.deleteContract('com.example.Outlook@2');
        expect(await service.sync()).toMatchObject({ status: 'succeeded' });
        const outlook = await repository.getResource('com.example.Outlook');
        expect(outlook?.contract?.versions.map((v) => v.version)).toEqual(['2', '1']);
        expect(outlook?.contract?.syncedAt).toBe(syncedAt);
    });

    it('only believes a contract\'s own host about its versions', async () => {
        const peer = await startNode({ resources: PEER_RESOURCES, contracts: PEER_CONTRACTS });
        nodes = [peer, await startNode({ resources: [weather], contracts: SOURCE_CONTRACTS, startingPeer: peer.baseUrl, port })];
        const forged = { ...PEER_CONTRACTS[0], path: 'org.archive', name: 'Visits', version: '9', source: 'contract org.archive.Visits@9(bookId: string): int32 {\n  return 0\n}', parameters: [], returnType: 'int32', ownerOrganizationId: null, createdAt: new Date().toISOString() };
        // The source lists its own contract's versions, and claims a newer version of the peer's.
        service = new SyncService(db, {
            sourceUrl,
            grantProbeIntervalMs: 60_000,
            clientFor: (baseUrl) => new NodeClient(baseUrl, 10_000, async (input, init) => {
                const response = await fetch(input, init);
                if (baseUrl !== sourceUrl || !String(input).includes('/v1/contracts')) return response;
                const { contracts } = await response.json() as { contracts: unknown[] };
                return Response.json({ contracts: [...contracts, forged], nextOffset: null });
            }),
        });
        await service.sync();
        expect((await repository.getResource('com.example.Outlook'))?.contract?.latestVersion).toBe('2');
        const visits = await repository.getResource('org.archive.Visits');
        expect(visits?.contract).toMatchObject({ latestVersion: '1', source: PEER_CONTRACTS[0].source });
        expect((await db.select({ version: contractVersionsTable.version }).from(contractVersionsTable)).map((row) => row.version).sort()).toEqual(['1', '1', '2']);
    });

    it('joins a sync already in progress', async () => {
        await startSource({ resources: [weather] });
        const [a, b] = await Promise.all([service.sync(), service.sync()]);
        expect(a.id).toBe(b.id);
    });
});
