import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/database.js';
import { nodesTable, resourceFunctionsTable, resourcesTable } from '../db/schema.js';
import {
    described,
    freePort,
    open,
    PEER_RESOURCES,
    paid,
    type RunningNode,
    restricted,
    SAMPLE_RECIPIENT,
    SOURCE_RESOURCES,
    type StartNodeOptions,
    startNode,
} from '@registry/node-fixtures';
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
        expect(run).toMatchObject({ status: 'succeeded', resourcesSeen: 4, resourcesAdded: 4, resourcesRemoved: 0 });

        const detail = await repository.getResource('io.quallet.finance.Ledger');
        expect(detail?.functions).toEqual([
            {
                name: 'balance',
                returnType: 'int64',
                description: 'The account\'s balance, in lamports.',
                parameters: [{ name: 'account', type: 'string', description: 'The account ID.' }],
                paymentManifest: null,
                restricted: true,
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
                paymentManifest: { costLamports: 5_000, recipientAddress: SAMPLE_RECIPIENT },
                restricted: true,
            },
            { name: 'rates', returnType: 'string', description: 'Current exchange rates as JSON.', parameters: [], paymentManifest: null, restricted: false },
        ]);
        expect(detail).toMatchObject({
            website: 'https://ledger.example.com',
            description: 'Account balances and transfers. Balance and transfer calls need a grant.',
        });
        expect(detail?.host).toMatchObject({ baseUrl: node.baseUrl, publicKey: node.publicKey, isSource: true });
    });

    it('marks resources the node stops listing as removed, and restores them when listed again', async () => {
        await startSource({ resources: [weather, ledger] });
        await service.sync();

        await startSource({ resources: [weather] });
        expect(await service.sync()).toMatchObject({ resourcesSeen: 1, resourcesAdded: 0, resourcesRemoved: 1 });
        expect((await repository.getResource('io.example.Ledger'))?.removedAt).not.toBeNull();
        const live = await repository.search({ in: 'all', paid: false, restricted: false, offset: 0, limit: 10 });
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
        expect(detail?.functions.map((fn) => [fn.name, fn.paymentManifest?.costLamports])).toEqual([['temperature', 20_000]]);
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
        expect((await repository.search({ in: 'all', paid: false, restricted: false, offset: 0, limit: 10 })).items[0].description).toBe('Forecasts');

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

        expect(await service.sync()).toMatchObject({ status: 'succeeded', resourcesSeen: 6 });
        expect((await repository.getResource('org.archive.Library'))?.baseUrl).toBe(peer.baseUrl);

        const byUrl = new Map((await repository.getNodes()).map((node) => [node.baseUrl, node]));
        expect(byUrl.get(source.baseUrl)).toMatchObject({ isSource: true, resourceCount: 4, acceptsGrantRequests: true });
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

    it('joins a sync already in progress', async () => {
        await startSource({ resources: [weather] });
        const [a, b] = await Promise.all([service.sync(), service.sync()]);
        expect(a.id).toBe(b.id);
    });
});
