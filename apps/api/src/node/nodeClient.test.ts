import { describe, expect, it } from 'vitest';
import { parseResource } from './nodeClient.js';

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
        ['a non-string parameter description', { ...valid, functions: [{ ...valid.functions[0], parameters: [{ name: 'city', type: 'string', description: ['A city'] }] }] }],
    ])('rejects %s', (_, resource) => {
        expect(parseResource(resource)).toBeUndefined();
    });

    it('treats anything but `restricted: true` as open', () => {
        const parsed = parseResource({ ...valid, functions: [{ ...valid.functions[0], restricted: 'yes' }] });
        expect(parsed?.functions[0].restricted).toBe(false);
    });
});
