import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { inference, open, paid, perToken, type RunningNode, restricted, SAMPLE_CONTRACT_PRICE, SAMPLE_ORGANIZATION, startNode } from '@registry/node-fixtures';
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
                { path: 'ai.example', name: 'Assistant', functions: [
                    perToken(inference('complete', 'prompt: string', 'string'), 3_000_000, 15_000_000),
                    inference('summarize', 'text: string', 'string'),
                    paid('classify', 'text: string', 'string', 500),
                ] },
            ],
            events: [
                { source: 'event com.example.OrderPlaced(orderId: string, total: decimal)', description: 'An order was placed' },
                { source: 'event com.example.OrderPlaced@1.10(orderId: string, total: decimal, currency: string)' },
                { source: 'event com.example.OrderPlaced@1.9(orderId: string)' },
                { source: 'restricted event io.example.Audit(entry: string)' },
            ],
            contracts: [
                { source: 'contract com.example.OnOrder consumes com.example.OrderPlaced@1.10 {\n  const seen = orderId\n}', description: 'Watches orders' },
                { source: 'contract com.example.OnOrder@2 consumes com.example.OrderPlaced@1.10 {\n  const seen = currency\n}' },
                { source: 'contract com.example.Sum(a: int32, b: int32): int32 {\n  return a + b\n}', description: 'Adds two numbers' },
                { source: 'contract com.example.Sum@1.10(a: int32, b: int32, c: int32): int32 {\n  return a + b + c\n}', description: 'Adds three numbers' },
                { source: 'contract com.example.Sum@1.9(a: int32): int32 {\n  return a\n}' },
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
        expect(body).toMatchObject({ resources: 6, functions: 9, paidFunctions: 5, restrictedFunctions: 1, inferenceFunctions: 2, contracts: 1, eventTypes: 2, eventContracts: 1, nodes: 1, lastSync: { status: 'succeeded' } });
    });

    it('ranks an exact name above prefix and substring matches', async () => {
        const { body } = await get('/v1/resources?q=weather');
        expect(body.items.map((r: { fqn: string }) => r.fqn)).toEqual(['com.example.Weather', 'com.example.weather.Radar']);
        expect(body.items[0]).toMatchObject({ functionCount: 2, paidFunctionCount: 2, perTokenFunctionCount: 0, inferenceFunctionCount: 0, price: { minMicroUsd: 2_500, maxMicroUsd: 10_000 } });
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

    it('filters to paid, restricted, inference or contract resources', async () => {
        const fqns = async (url: string) => (await get(url)).body.items.map((r: { fqn: string }) => r.fqn).sort();
        expect(await fqns('/v1/resources?paid=true')).toEqual(['ai.example.Assistant', 'com.example.Sum', 'com.example.Weather']);
        expect(await fqns('/v1/resources?restricted=true')).toEqual(['io.example.Ledger']);
        expect(await fqns('/v1/resources?inference=true')).toEqual(['ai.example.Assistant']);
        expect(await fqns('/v1/resources?contract=true')).toEqual(['com.example.Sum']);
    });

    it('keeps per-token functions out of the per-call price range', async () => {
        const { body } = await get('/v1/resources?q=ai.example.Assistant');
        expect(body.items[0]).toMatchObject({
            functionCount: 3,
            paidFunctionCount: 2,
            perTokenFunctionCount: 1,
            inferenceFunctionCount: 2,
            price: { minMicroUsd: 500, maxMicroUsd: 500 },
        });
    });

    it('returns an inference function\'s kind and per-token manifest', async () => {
        const { body } = await get('/v1/resources/ai.example.Assistant');
        expect(body.functions[0]).toEqual({
            name: 'complete',
            returnType: 'string',
            description: null,
            parameters: [{ name: 'prompt', type: 'string', description: null }, { name: 'maxTokens', type: 'int32', description: null }],
            paymentManifest: { inputCostMicroUsdPerMillionTokens: 3_000_000, outputCostMicroUsdPerMillionTokens: 15_000_000, recipientOrganizationId: SAMPLE_ORGANIZATION },
            restricted: false,
            kind: 'inference',
        });
        expect(body.functions.map((fn: { kind: string }) => fn.kind)).toEqual(['inference', 'inference', 'fixed']);
    });

    it('returns a contract with its versions, newest first, and the latest source', async () => {
        const summary = (await get('/v1/resources?q=com.example.Sum')).body.items[0];
        expect(summary).toMatchObject({ isContract: true, functionCount: 1, paidFunctionCount: 1, perTokenFunctionCount: 1, price: null });

        const { body } = await get('/v1/resources/com.example.Sum');
        expect(body.functions).toEqual([{
            name: 'run',
            returnType: 'int32',
            description: null,
            parameters: [{ name: 'a', type: 'int32', description: null }, { name: 'b', type: 'int32', description: null }, { name: 'c', type: 'int32', description: null }],
            paymentManifest: { priceMicroUsdPerMillionTokens: SAMPLE_CONTRACT_PRICE, recipientOrganizationId: SAMPLE_ORGANIZATION },
            restricted: false,
            kind: 'contract',
        }]);
        // 1.10 is newer than 1.9, which was deployed after it.
        expect(body.contract).toMatchObject({
            ownerOrganizationId: null,
            latestVersion: '1.10',
            source: 'contract com.example.Sum@1.10(a: int32, b: int32, c: int32): int32 {\n  return a + b + c\n}',
        });
        expect(body.contract.syncedAt).not.toBeNull();
        expect(body.contract.versions.map((v: { version: string }) => v.version)).toEqual(['1.10', '1.9', '1']);
        expect(body.contract.versions[2]).toEqual({
            version: '1',
            parameters: [{ name: 'a', type: 'int32' }, { name: 'b', type: 'int32' }],
            returnType: 'int32',
            description: 'Adds two numbers',
            deployedAt: expect.any(String),
        });
        expect(body.contract.versions[2]).not.toHaveProperty('source');

        expect((await get('/v1/resources/com.example.Weather')).body.contract).toBeNull();
    });

    it('returns one version of a contract with its source', async () => {
        const { status, body } = await get('/v1/resources/com.example.Sum/versions/1');
        expect(status).toBe(200);
        expect(body).toMatchObject({ fqn: 'com.example.Sum', version: '1', source: 'contract com.example.Sum(a: int32, b: int32): int32 {\n  return a + b\n}' });
        expect((await get('/v1/resources/com.example.Sum/versions/3')).status).toBe(404);
        expect((await get('/v1/resources/com.example.Weather/versions/1')).status).toBe(404);
    });

    it('pages results', async () => {
        const first = await get('/v1/resources?limit=3');
        expect(first.body.items).toHaveLength(3);
        expect(first.body.nextOffset).toBe(3);
        const last = await get('/v1/resources?limit=3&offset=3');
        expect(last.body.items).toHaveLength(3);
        expect(last.body.nextOffset).toBeNull();
        expect((await get('/v1/resources?limit=1000')).status).toBe(400);
    });

    it('returns resource detail with grant info for its host', async () => {
        const { status, body } = await get('/v1/resources/io.example.Ledger');
        expect(status).toBe(200);
        expect(body).toMatchObject({ website: null, description: null });
        expect(body.functions).toEqual([{ name: 'balance', returnType: 'int64', description: null, parameters: [], paymentManifest: null, restricted: true, kind: 'fixed' }]);
        expect(body.host).toMatchObject({ acceptsGrantRequests: true, grantEndpoint: `${node.baseUrl}/v1/grants/request` });
        expect((await get('/v1/resources/com.example.Missing')).status).toBe(404);
    });

    it('searches event types by fqn, field name or event contract', async () => {
        const fqns = async (url: string) => (await get(url)).body.items.map((event: { fqn: string }) => event.fqn);
        expect(await fqns('/v1/events')).toEqual(expect.arrayContaining(['com.example.OrderPlaced', 'io.example.Audit']));
        expect(await fqns('/v1/events?restricted=true')).toEqual(['io.example.Audit']);
        expect(await fqns('/v1/events?q=_')).toEqual([]);

        const { body } = await get('/v1/events?q=currency');
        // 1.10 is the latest version, so its fields are the ones searched and shown.
        expect(body).toEqual({
            items: [{
                fqn: 'com.example.OrderPlaced',
                path: 'com.example',
                name: 'OrderPlaced',
                baseUrl: node.baseUrl,
                ownerOrganizationId: SAMPLE_ORGANIZATION,
                latestVersion: '1.10',
                fields: [{ name: 'orderId', type: 'string' }, { name: 'total', type: 'decimal' }, { name: 'currency', type: 'string' }],
                restricted: false,
                description: null,
                consumerCount: 1,
                matchedConsumers: [],
                matchedFields: ['currency'],
                lastSeenAt: expect.any(String),
                removedAt: null,
            }],
            nextOffset: null,
        });
        expect((await get('/v1/events?q=OnOrder')).body.items).toMatchObject([{ fqn: 'com.example.OrderPlaced', matchedConsumers: ['com.example.OnOrder'] }]);
        expect((await get('/v1/events?limit=1000')).status).toBe(400);
    });

    it('returns an event type with its versions, newest first, and its event contracts', async () => {
        const { status, body } = await get('/v1/events/com.example.OrderPlaced');
        expect(status).toBe(200);
        expect(body.versions.map((v: { version: string }) => v.version)).toEqual(['1.10', '1.9', '1']);
        expect(body.versions[2]).toEqual({ version: '1', fields: [{ name: 'orderId', type: 'string' }, { name: 'total', type: 'decimal' }], restricted: false, description: 'An order was placed', declaredAt: expect.any(String) });
        expect(body.consumers).toEqual([{
            fqn: 'com.example.OnOrder',
            path: 'com.example',
            name: 'OnOrder',
            baseUrl: node.baseUrl,
            eventVersion: '1.10',
            ownerOrganizationId: SAMPLE_ORGANIZATION,
            description: null,
            latestVersion: '2',
        }]);
        expect(body.host).toMatchObject({ baseUrl: node.baseUrl, isSource: true });
        expect((await get('/v1/events/com.example.Missing')).status).toBe(404);
    });

    it('returns an event contract and one version with its source', async () => {
        const { status, body } = await get('/v1/event-contracts/com.example.OnOrder');
        expect(status).toBe(200);
        expect(body).toMatchObject({
            consumes: { fqn: 'com.example.OrderPlaced', version: '1.10', known: true },
            contract: { latestVersion: '2', source: 'contract com.example.OnOrder@2 consumes com.example.OrderPlaced@1.10 {\n  const seen = currency\n}' },
        });
        expect(body.contract.versions.map((v: { version: string; description: string | null }) => [v.version, v.description])).toEqual([['2', null], ['1', 'Watches orders']]);

        const version = await get('/v1/event-contracts/com.example.OnOrder/versions/1');
        expect(version.body).toMatchObject({ fqn: 'com.example.OnOrder', version: '1', parameters: [], returnType: '', source: expect.stringContaining('const seen = orderId') });
        expect((await get('/v1/event-contracts/com.example.OnOrder/versions/3')).status).toBe(404);
        // An event contract isn't a resource, and a resource isn't an event contract.
        expect((await get('/v1/resources/com.example.OnOrder')).status).toBe(404);
        expect((await get('/v1/event-contracts/com.example.Sum')).status).toBe(404);
    });

    it('lists nodes and sync runs', async () => {
        expect((await get('/v1/nodes')).body.items).toMatchObject([{ baseUrl: node.baseUrl, isSource: true, resourceCount: 6 }]);
        expect((await get('/v1/sync/runs')).body.items[0]).toMatchObject({ status: 'succeeded', resourcesSeen: 6 });
    });

    it('requires the admin key to trigger a sync', async () => {
        expect((await app.inject({ method: 'POST', url: '/v1/sync' })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST', url: '/v1/sync', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
        const response = await app.inject({ method: 'POST', url: '/v1/sync', headers: { authorization: 'Bearer admin-key' } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: 'succeeded', resourcesSeen: 6, resourcesAdded: 0 });
    });
});
