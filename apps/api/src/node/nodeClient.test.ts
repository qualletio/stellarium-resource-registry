import { describe, expect, it } from 'vitest';
import { MAX_CONTRACT_SOURCE_BYTES, MAX_STRUCT_FIELDS, parseContract, parseEventSubscription, parseEventType, parseResource, parseStruct } from './nodeClient.js';

const valid = {
    path: 'com.example',
    name: 'Weather',
    baseUrl: 'http://node.example/',
    functions: [
        { name: 'temperature', returnType: 'int32', parameters: [{ name: 'city', type: 'string' }], paymentManifest: { costMicroUsd: 10, recipientOrganizationId: 'org_1' }, restricted: true },
    ],
};

const complete = {
    name: 'complete',
    returnType: 'string',
    parameters: [{ name: 'prompt', type: 'string' }, { name: 'maxTokens', type: 'int32' }],
    paymentManifest: { inputCostMicroUsdPerMillionTokens: 3_000_000, outputCostMicroUsdPerMillionTokens: 0, recipientOrganizationId: 'org_1' },
    kind: 'inference',
};

const run = {
    name: 'run',
    returnType: 'string',
    parameters: [{ name: 'city', type: 'string' }],
    paymentManifest: { priceMicroUsdPerMillionTokens: 2_000_000, recipientOrganizationId: 'org_1' },
    kind: 'contract',
};

describe('parseResource', () => {
    it('accepts a well-formed resource and normalizes its base URL', () => {
        expect(parseResource(valid)).toEqual({
            path: 'com.example',
            name: 'Weather',
            baseUrl: 'http://node.example',
            functions: [{ name: 'temperature', returnType: 'int32', parameters: [{ name: 'city', type: 'string' }], paymentManifest: { costMicroUsd: 10, recipientOrganizationId: 'org_1' }, restricted: true, kind: 'fixed', payable: false }],
        });
    });

    it('accepts an inference function with per-token rates', () => {
        const parsed = parseResource({ ...valid, functions: [complete] });
        expect(parsed?.functions[0]).toMatchObject({
            kind: 'inference',
            paymentManifest: { inputCostMicroUsdPerMillionTokens: 3_000_000, outputCostMicroUsdPerMillionTokens: 0, recipientOrganizationId: 'org_1' },
        });
        expect(parseResource({ ...valid, functions: [{ ...complete, paymentManifest: undefined }] })?.functions[0]).toMatchObject({ kind: 'inference', paymentManifest: undefined });
    });

    it('accepts a contract priced per script token', () => {
        expect(parseResource({ ...valid, functions: [run] })?.functions).toEqual([{ ...run, description: undefined, restricted: false, payable: false }]);
    });

    it('accepts a contract with a function per pub fn, and keeps which are payable', () => {
        const tip = { ...run, name: 'tip', parameters: [], returnType: 'void', payable: true };
        expect(parseResource({ ...valid, functions: [run, tip] })?.functions.map((fn) => [fn.name, fn.payable])).toEqual([['run', false], ['tip', true]]);
        // Only a contract's functions can be payable.
        expect(parseResource({ ...valid, functions: [{ ...valid.functions[0], payable: true }] })?.functions[0].payable).toBe(false);
    });

    it('keeps descriptions and an http(s) website, and treats null or empty ones as absent', () => {
        const parsed = parseResource({
            ...valid,
            website: 'https://weather.example',
            description: 'Forecasts',
            functions: [{ ...valid.functions[0], description: 'Degrees Celsius', parameters: [{ name: 'city', type: 'string', description: 'A city' }] }],
        });
        expect(parsed).toMatchObject({ website: 'https://weather.example', description: 'Forecasts' });
        expect(parsed?.functions[0]).toMatchObject({ description: 'Degrees Celsius', parameters: [{ name: 'city', type: 'string', description: 'A city' }] });

        const absent = parseResource({ ...valid, website: null, description: '' });
        expect(absent?.website).toBeUndefined();
        expect(absent?.description).toBeUndefined();
    });

    it.each([
        ['a non-http base URL', { ...valid, baseUrl: 'file:///etc/passwd' }],
        ['a missing path', { ...valid, path: '' }],
        ['a negative price', { ...valid, functions: [{ ...valid.functions[0], paymentManifest: { costMicroUsd: -1, recipientOrganizationId: 'org_1' } }] }],
        ['a fractional price', { ...valid, functions: [{ ...valid.functions[0], paymentManifest: { costMicroUsd: 1.5, recipientOrganizationId: 'org_1' } }] }],
        ['a lamport price from a pre-USDC node', { ...valid, functions: [{ ...valid.functions[0], paymentManifest: { costLamports: 10, recipientOrganizationId: 'org_1' } }] }],
        ['a USDC price from a pre-0.17 node', { ...valid, functions: [{ ...valid.functions[0], paymentManifest: { costMicroUsdc: 10, recipientAddress: 'addr' } }] }],
        ['a malformed parameter', { ...valid, functions: [{ ...valid.functions[0], parameters: [{ name: 'city' }] }] }],
        ['a duplicate function', { ...valid, functions: [valid.functions[0], valid.functions[0]] }],
        ['a javascript: website', { ...valid, website: 'javascript:alert(1)' }],
        ['a website that is not a URL', { ...valid, website: 'weather.example' }],
        ['a non-string description', { ...valid, description: { text: 'Forecasts' } }],
        ['a non-string function description', { ...valid, functions: [{ ...valid.functions[0], description: 42 }] }],
        ['an unknown function kind', { ...valid, functions: [{ ...valid.functions[0], kind: 'streaming' }] }],
        ['an inference function without maxTokens', { ...valid, functions: [{ ...complete, parameters: [{ name: 'prompt', type: 'string' }] }] }],
        ['an inference function with a non-int32 maxTokens', { ...valid, functions: [{ ...complete, parameters: [{ name: 'maxTokens', type: 'int64' }] }] }],
        ['an inference function with a per-call price', { ...valid, functions: [{ ...complete, paymentManifest: { costMicroUsd: 10, recipientOrganizationId: 'org_1' } }] }],
        ['a fixed function with per-token rates', { ...valid, functions: [{ ...complete, kind: undefined }] }],
        ['a negative token rate', { ...valid, functions: [{ ...complete, paymentManifest: { ...complete.paymentManifest, outputCostMicroUsdPerMillionTokens: -1 } }] }],
        ['a missing token rate', { ...valid, functions: [{ ...complete, paymentManifest: { inputCostMicroUsdPerMillionTokens: 1, recipientOrganizationId: 'org_1' } }] }],
        ['a contract without a price', { ...valid, functions: [{ ...run, paymentManifest: undefined }] }],
        ['a contract with a per-call price', { ...valid, functions: [{ ...run, paymentManifest: { costMicroUsd: 10, recipientOrganizationId: 'org_1' } }] }],
        ['a contract alongside functions that aren\'t its own', { ...valid, functions: [run, valid.functions[0]] }],
        ['a contract function with a non-boolean payable', { ...valid, functions: [{ ...run, payable: 'yes' }] }],
        ['a fixed function with a contract price', { ...valid, functions: [{ ...run, kind: undefined }] }],
        ['a non-string parameter description', { ...valid, functions: [{ ...valid.functions[0], parameters: [{ name: 'city', type: 'string', description: ['A city'] }] }] }],
    ])('rejects %s', (_, resource) => {
        expect(parseResource(resource)).toBeUndefined();
    });

    it('treats anything but `restricted: true` as open', () => {
        const parsed = parseResource({ ...valid, functions: [{ ...valid.functions[0], restricted: 'yes' }] });
        expect(parsed?.functions[0].restricted).toBe(false);
    });
});

const contract = {
    path: 'com.example',
    name: 'Outlook',
    version: '1.2',
    source: 'contract com.example.Outlook@1.2 {\n  pub fn today(city: string): string {\n    return city\n  }\n}',
    functions: [{ name: 'today', parameters: [{ name: 'city', type: 'string' }], returnType: 'string', payable: false }],
    ownerOrganizationId: 'org_1',
    description: 'Today in words',
    createdAt: '2026-10-30T12:00:00.000Z',
};

describe('parseContract', () => {
    it('accepts a well-formed contract version', () => {
        expect(parseContract(contract)).toEqual({ ...contract, createdAt: new Date(contract.createdAt) });
        expect(parseContract({ ...contract, ownerOrganizationId: null, description: null })).toMatchObject({ ownerOrganizationId: null, description: undefined });
    });

    it('accepts an event contract, whose one function is its handler', () => {
        const on = { name: 'on', parameters: [{ name: 'city', type: 'string' }], returnType: 'void', payable: false };
        expect(parseContract({ ...contract, functions: [on] })).toMatchObject({ functions: [on] });
    });

    it('reads payable as false unless it is true', () => {
        expect(parseContract({ ...contract, functions: [{ ...contract.functions[0], payable: undefined }] })?.functions[0].payable).toBe(false);
        expect(parseContract({ ...contract, functions: [{ ...contract.functions[0], payable: true }] })?.functions[0].payable).toBe(true);
    });

    it.each([
        ['a missing path', { ...contract, path: '' }],
        ['a non-numeric version', { ...contract, version: 'latest' }],
        ['a version with an empty segment', { ...contract, version: '1..2' }],
        ['an empty source', { ...contract, source: '' }],
        ['a source over the size limit', { ...contract, source: 'x'.repeat(MAX_CONTRACT_SOURCE_BYTES + 1) }],
        ['a version in RequestScript 1\'s shape', { ...contract, functions: undefined, parameters: [], returnType: 'string' }],
        ['a malformed parameter', { ...contract, functions: [{ ...contract.functions[0], parameters: [{ name: 'city' }] }] }],
        ['a non-string return type', { ...contract, functions: [{ ...contract.functions[0], returnType: 7 }] }],
        ['a duplicate function', { ...contract, functions: [contract.functions[0], contract.functions[0]] }],
        ['a non-string owner', { ...contract, ownerOrganizationId: 7 }],
        ['an owner too long to store', { ...contract, ownerOrganizationId: 'o'.repeat(65) }],
        ['a non-string description', { ...contract, description: 42 }],
        ['an invalid deploy time', { ...contract, createdAt: 'yesterday' }],
    ])('rejects %s', (_, value) => {
        expect(parseContract(value)).toBeUndefined();
    });
});

const eventType = {
    path: 'com.example',
    name: 'OrderPlaced',
    version: '1',
    fields: [{ name: 'orderId', type: 'string' }, { name: 'total', type: 'decimal' }],
    restricted: false,
    ownerOrganizationId: 'org_1',
    baseUrl: 'http://node.example/',
    description: 'An order was placed.',
    createdAt: '2026-11-02T12:00:00.000Z',
};

describe('parseEventType', () => {
    it('accepts a well-formed event type and normalizes its base URL', () => {
        expect(parseEventType(eventType)).toEqual({ ...eventType, baseUrl: 'http://node.example', createdAt: new Date(eventType.createdAt) });
        expect(parseEventType({ ...eventType, fields: [], restricted: true, description: null })).toMatchObject({ fields: [], restricted: true, description: undefined });
    });

    it.each([
        ['a missing name', { ...eventType, name: '' }],
        ['a non-numeric version', { ...eventType, version: 'v1' }],
        ['a malformed field', { ...eventType, fields: [{ name: 'orderId' }] }],
        ['a repeated field', { ...eventType, fields: [{ name: 'a', type: 'string' }, { name: 'a', type: 'int32' }] }],
        ['a non-boolean restriction', { ...eventType, restricted: 'yes' }],
        ['a missing owner', { ...eventType, ownerOrganizationId: null }],
        ['an owner too long to store', { ...eventType, ownerOrganizationId: 'o'.repeat(65) }],
        ['a non-http base URL', { ...eventType, baseUrl: 'ftp://node.example' }],
        ['an invalid declare time', { ...eventType, createdAt: 'today' }],
    ])('rejects %s', (_, value) => {
        expect(parseEventType(value)).toBeUndefined();
    });
});

const subscription = { eventPath: 'com.example', eventName: 'OrderPlaced', eventVersion: '1', consumer: 'com.shop.OnOrder', ownerOrganizationId: 'org_2' };

describe('parseEventSubscription', () => {
    it('splits the event contract into its path and name', () => {
        expect(parseEventSubscription(subscription)).toEqual({
            path: 'com.shop',
            name: 'OnOrder',
            eventPath: 'com.example',
            eventName: 'OrderPlaced',
            eventVersion: '1',
            ownerOrganizationId: 'org_2',
        });
        expect(parseEventSubscription({ ...subscription, ownerOrganizationId: null })).toMatchObject({ ownerOrganizationId: null });
    });

    it.each([
        ['a consumer without a path', { ...subscription, consumer: 'OnOrder' }],
        ['a consumer without a name', { ...subscription, consumer: 'com.shop.' }],
        ['a missing event name', { ...subscription, eventName: '' }],
        ['a non-numeric event version', { ...subscription, eventVersion: 'latest' }],
        ['a non-string owner', { ...subscription, ownerOrganizationId: 3 }],
    ])('rejects %s', (_, value) => {
        expect(parseEventSubscription(value)).toBeUndefined();
    });
});

const struct = {
    path: 'com.example',
    name: 'Address',
    version: '1',
    fields: [{ name: 'street', type: 'string' }, { name: 'owner', type: 'com.example.Customer@2' }],
    ownerOrganizationId: 'org_1',
    baseUrl: 'http://node.example/',
    description: 'A postal address.',
    createdAt: '2026-11-04T12:00:00.000Z',
};

describe('parseStruct', () => {
    it('accepts a well-formed struct and normalizes its base URL', () => {
        expect(parseStruct(struct)).toEqual({ ...struct, baseUrl: 'http://node.example', createdAt: new Date(struct.createdAt) });
        expect(parseStruct({ ...struct, version: '1.10', description: null })).toMatchObject({ version: '1.10', description: undefined });
    });

    it.each([
        ['a missing path', { ...struct, path: '' }],
        ['a non-numeric version', { ...struct, version: 'v1' }],
        ['a missing version', { ...struct, version: undefined }],
        ['a malformed field', { ...struct, fields: [{ name: 'street', type: '' }] }],
        ['a repeated field', { ...struct, fields: [{ name: 'a', type: 'string' }, { name: 'a', type: 'int32' }] }],
        ['more fields than a node allows', { ...struct, fields: Array.from({ length: MAX_STRUCT_FIELDS + 1 }, (_, i) => ({ name: `f${i}`, type: 'string' })) }],
        ['a missing owner', { ...struct, ownerOrganizationId: null }],
        ['a non-http base URL', { ...struct, baseUrl: 'javascript:alert(1)' }],
        ['a non-string description', { ...struct, description: 3 }],
        ['an invalid declare time', { ...struct, createdAt: 'today' }],
    ])('rejects %s', (_, value) => {
        expect(parseStruct(value)).toBeUndefined();
    });
});
