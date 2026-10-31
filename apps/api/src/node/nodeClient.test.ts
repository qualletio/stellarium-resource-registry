import { describe, expect, it } from 'vitest';
import { MAX_CONTRACT_SOURCE_BYTES, parseContract, parseResource } from './nodeClient.js';

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
            functions: [{ name: 'temperature', returnType: 'int32', parameters: [{ name: 'city', type: 'string' }], paymentManifest: { costMicroUsd: 10, recipientOrganizationId: 'org_1' }, restricted: true, kind: 'fixed' }],
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
        expect(parseResource({ ...valid, functions: [run] })?.functions).toEqual([{ ...run, description: undefined, restricted: false }]);
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
        ['a contract function not named run', { ...valid, functions: [{ ...run, name: 'call' }] }],
        ['a contract alongside other functions', { ...valid, functions: [run, valid.functions[0]] }],
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
    source: 'contract com.example.Outlook@1.2(city: string): string {\n  return city\n}',
    parameters: [{ name: 'city', type: 'string' }],
    returnType: 'string',
    ownerOrganizationId: 'org_1',
    description: 'Today in words',
    createdAt: '2026-10-30T12:00:00.000Z',
};

describe('parseContract', () => {
    it('accepts a well-formed contract version', () => {
        expect(parseContract(contract)).toEqual({ ...contract, createdAt: new Date(contract.createdAt) });
        expect(parseContract({ ...contract, ownerOrganizationId: null, description: null })).toMatchObject({ ownerOrganizationId: null, description: undefined });
    });

    it.each([
        ['a missing path', { ...contract, path: '' }],
        ['a non-numeric version', { ...contract, version: 'latest' }],
        ['a version with an empty segment', { ...contract, version: '1..2' }],
        ['an empty source', { ...contract, source: '' }],
        ['a source over the size limit', { ...contract, source: 'x'.repeat(MAX_CONTRACT_SOURCE_BYTES + 1) }],
        ['a malformed parameter', { ...contract, parameters: [{ name: 'city' }] }],
        ['a missing return type', { ...contract, returnType: '' }],
        ['a non-string owner', { ...contract, ownerOrganizationId: 7 }],
        ['an owner too long to store', { ...contract, ownerOrganizationId: 'o'.repeat(65) }],
        ['a non-string description', { ...contract, description: 42 }],
        ['an invalid deploy time', { ...contract, createdAt: 'yesterday' }],
    ])('rejects %s', (_, value) => {
        expect(parseContract(value)).toBeUndefined();
    });
});
