import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { open, paid, type RunningNode, restricted, startNode } from '@registry/node-fixtures';
import { SyncService } from './sync/syncService.js';
import { createTestDatabase } from './testing.js';


describe('routes', () => {
    let app: FastifyInstance;
    let node: RunningNode;
    let close: () => Promise<void>;

    beforeAll(async () => {
        const database = await createTestDatabase();
        close = database.close;
        node = await startNode({
            approveGrants: true,
            resources: [
                { path: 'com.example', name: 'Weather', functions: [
                    paid('temperature', 'city: string', 'int32', 10_000),
                    paid('forecast', '', 'string', 2_500),
                ] },
                { path: 'com.example.weather', name: 'Radar', functions: [open('image', '', 'string')] },
                { path: 'io.example', name: 'Ledger', functions: [restricted(open('balance', '', 'int64'))] },
                { path: 'org.percent_sign', name: 'Literal', functions: [open('x', '', 'string')] },
            ],
        });
        const syncService = new SyncService(database.db, { sourceUrl: node.baseUrl, grantProbeIntervalMs: 60_000 });
        app = await buildApp({ db: database.db, syncService, sourceUrl: node.baseUrl, adminApiKey: 'admin-key', webOrigin: 'http://localhost:3000' });
        await syncService.sync();
    });

    afterAll(async () => {
        await app.close();
        await node.close();
        await close();
    });

    const get = async (url: string) => {
        const response = await app.inject({ method: 'GET', url });
        return { status: response.statusCode, body: response.json() };
    };

    it('reports stats', async () => {
        const { body } = await get('/v1/stats');
        expect(body).toMatchObject({ resources: 4, functions: 5, paidFunctions: 2, restrictedFunctions: 1, nodes: 1, lastSync: { status: 'succeeded' } });
    });

    it('ranks an exact name above prefix and substring matches', async () => {
        const { body } = await get('/v1/resources?q=weather');
        expect(body.items.map((r: { fqn: string }) => r.fqn)).toEqual(['com.example.Weather', 'com.example.weather.Radar']);
        expect(body.items[0]).toMatchObject({ functionCount: 2, paidFunctionCount: 2, price: { minLamports: 2_500, maxLamports: 10_000 } });
    });

    it('searches by path, name or function name', async () => {
        const fqns = async (url: string) => (await get(url)).body.items.map((r: { fqn: string }) => r.fqn);
        expect(await fqns('/v1/resources?q=io.example&in=path')).toEqual(['io.example.Ledger']);
        expect(await fqns('/v1/resources?q=radar&in=name')).toEqual(['com.example.weather.Radar']);
        expect(await fqns('/v1/resources?q=Radar&in=path')).toEqual([]);
        const byFunction = await get('/v1/resources?q=temp&in=function');
        expect(byFunction.body.items).toMatchObject([{ fqn: 'com.example.Weather', matchedFunctions: ['temperature'] }]);
    });

    it('matches LIKE wildcards literally', async () => {
        expect((await get('/v1/resources?q=_')).body.items.map((r: { fqn: string }) => r.fqn)).toEqual(['org.percent_sign.Literal']);
        expect((await get('/v1/resources?q=%25')).body.items).toEqual([]);
    });

    it('filters to paid or restricted resources', async () => {
        expect((await get('/v1/resources?paid=true')).body.items.map((r: { fqn: string }) => r.fqn)).toEqual(['com.example.Weather']);
        expect((await get('/v1/resources?restricted=true')).body.items.map((r: { fqn: string }) => r.fqn)).toEqual(['io.example.Ledger']);
    });

    it('pages results', async () => {
        const first = await get('/v1/resources?limit=3');
        expect(first.body.items).toHaveLength(3);
        expect(first.body.nextOffset).toBe(3);
        const last = await get('/v1/resources?limit=3&offset=3');
        expect(last.body.items).toHaveLength(1);
        expect(last.body.nextOffset).toBeNull();
        expect((await get('/v1/resources?limit=1000')).status).toBe(400);
    });

    it('returns resource detail with grant info for its host', async () => {
        const { status, body } = await get('/v1/resources/io.example.Ledger');
        expect(status).toBe(200);
        expect(body).toMatchObject({ website: null, description: null });
        expect(body.functions).toEqual([{ name: 'balance', returnType: 'int64', description: null, parameters: [], paymentManifest: null, restricted: true }]);
        expect(body.host).toMatchObject({ acceptsGrantRequests: true, grantEndpoint: `${node.baseUrl}/v1/grants/request` });
        expect((await get('/v1/resources/com.example.Missing')).status).toBe(404);
    });

    it('lists nodes and sync runs', async () => {
        expect((await get('/v1/nodes')).body.items).toMatchObject([{ baseUrl: node.baseUrl, isSource: true, resourceCount: 4 }]);
        expect((await get('/v1/sync/runs')).body.items[0]).toMatchObject({ status: 'succeeded', resourcesSeen: 4 });
    });

    it('requires the admin key to trigger a sync', async () => {
        expect((await app.inject({ method: 'POST', url: '/v1/sync' })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST', url: '/v1/sync', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
        const response = await app.inject({ method: 'POST', url: '/v1/sync', headers: { authorization: 'Bearer admin-key' } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: 'succeeded', resourcesSeen: 4, resourcesAdded: 0 });
    });
});
