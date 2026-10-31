/**
 * A read-only client for a Stellarium node's public HTTP API (stellarium-ts `src/routes.ts`).
 * Everything a node returns is untrusted: entries that don't have the expected shape are dropped,
 * never coerced.
 */

export interface NodeSelf {
    baseUrl: string;
    name: string;
    publicKey: string;
}

export interface NodePeer {
    baseUrl: string;
    name: string;
    publicKey: string;
}

export type NodePaymentManifest =
    | { costMicroUsd: number; recipientOrganizationId: string }
    | { inputCostMicroUsdPerMillionTokens: number; outputCostMicroUsdPerMillionTokens: number; recipientOrganizationId: string }
    | { priceMicroUsdPerMillionTokens: number; recipientOrganizationId: string };

export interface NodeFunction {
    name: string;
    returnType: string;
    description?: string;
    parameters: { name: string; type: string; description?: string }[];
    /** Per-call for a fixed function, per-token for an inference function, per script token for a contract. */
    paymentManifest?: NodePaymentManifest;
    restricted: boolean;
    kind: 'fixed' | 'inference' | 'contract';
}

export interface NodeResource {
    path: string;
    name: string;
    baseUrl: string;
    /** Only http(s) URLs, since the web app links to it. */
    website?: string;
    description?: string;
    functions: NodeFunction[];
}

/** One version of a contract, as its host's `GET /v1/contracts` lists it. */
export interface NodeContract {
    path: string;
    name: string;
    version: string;
    source: string;
    parameters: { name: string; type: string }[];
    returnType: string;
    ownerOrganizationId: string | null;
    description?: string;
    createdAt: Date;
}

/** The outcome of calling a restricted function without authorization. */
export type GrantProbeResult =
    | { kind: 'restricted'; grantEndpoint: string | null }
    | { kind: 'unexpected'; status: number };

export class NodeRequestError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = 'NodeRequestError';
    }
}

/** The node's own maximum page size (`MAX_PAGE_SIZE` in stellarium-ts). */
const PAGE_SIZE = 500;
/** Stops a node that never returns `nextOffset: null` from paging forever. */
const MAX_PAGES = 1_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isNonnegativeSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** The parameter every inference function takes: the most output tokens a caller allows (`MAX_TOKENS_PARAMETER` in stellarium-ts). */
const MAX_TOKENS_PARAMETER = 'maxTokens';

/** The one function a contract's resource has (`CONTRACT_FUNCTION` in stellarium-ts). */
export const CONTRACT_FUNCTION = 'run';

/**
 * The largest contract source the registry stores. Nodes accept 64 KiB by default (`maxContractSourceBytes`),
 * and may raise it, so this leaves room without letting one node fill the database.
 */
export const MAX_CONTRACT_SOURCE_BYTES = 256 * 1024;

/** Organization IDs are stored as varchar(64). */
const MAX_ORGANIZATION_ID_LENGTH = 64;

/** Dot-separated numbers, as RequestScript versions are (`compareVersions` in requestscript). */
const VERSION_PATTERN = /^\d{1,15}(\.\d{1,15}){0,7}$/;

const isHttpUrl = (value: string): boolean => {
    try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
};

/** Only http(s) URLs, since the registry sends requests to the hosts nodes advertise. Trailing slashes are dropped. */
function parseBaseUrl(value: unknown): string | undefined {
    if (!isNonEmptyString(value) || !isHttpUrl(value)) return undefined;
    return value.replace(/\/+$/, '');
}

/**
 * An optional field that is absent (`undefined`, null or an empty string), valid, or malformed.
 * A malformed one drops the entry it belongs to.
 */
type Optional<T> = { ok: true; value?: T } | { ok: false };

function parseDescription(value: unknown): Optional<string> {
    if (value === undefined || value === null || value === '') return { ok: true };
    return typeof value === 'string' ? { ok: true, value } : { ok: false };
}

function parseWebsite(value: unknown): Optional<string> {
    if (value === undefined || value === null || value === '') return { ok: true };
    return typeof value === 'string' && isHttpUrl(value) ? { ok: true, value } : { ok: false };
}

function parsePeer(value: unknown): NodePeer | undefined {
    const baseUrl = isObject(value) ? parseBaseUrl(value.baseUrl) : undefined;
    if (!isObject(value) || !baseUrl || !isNonEmptyString(value.publicKey)) return undefined;
    return {
        baseUrl,
        name: isNonEmptyString(value.name) ? value.name : baseUrl,
        publicKey: value.publicKey,
    };
}

/** Absent means fixed, as nodes only send `kind` for inference functions and contracts. Any other value is malformed. */
function parseKind(value: unknown): NodeFunction['kind'] | undefined {
    if (value === undefined || value === null) return 'fixed';
    return value === 'fixed' || value === 'inference' || value === 'contract' ? value : undefined;
}

/**
 * A fixed function is priced per call, an inference function per million input and output tokens, and a
 * contract per million script tokens it executes.
 */
function parsePaymentManifest(value: unknown, kind: NodeFunction['kind']): Optional<NodePaymentManifest> {
    if (value === undefined || value === null) return { ok: true };
    if (!isObject(value) || !isNonEmptyString(value.recipientOrganizationId)) return { ok: false };
    if (kind === 'contract') {
        const price = value.priceMicroUsdPerMillionTokens;
        if (!isNonnegativeSafeInteger(price)) return { ok: false };
        return { ok: true, value: { priceMicroUsdPerMillionTokens: price, recipientOrganizationId: value.recipientOrganizationId } };
    }
    if (kind === 'inference') {
        const { inputCostMicroUsdPerMillionTokens: input, outputCostMicroUsdPerMillionTokens: output } = value;
        if (!isNonnegativeSafeInteger(input) || !isNonnegativeSafeInteger(output)) return { ok: false };
        return { ok: true, value: { inputCostMicroUsdPerMillionTokens: input, outputCostMicroUsdPerMillionTokens: output, recipientOrganizationId: value.recipientOrganizationId } };
    }
    if (!isNonnegativeSafeInteger(value.costMicroUsd)) return { ok: false };
    return { ok: true, value: { costMicroUsd: value.costMicroUsd, recipientOrganizationId: value.recipientOrganizationId } };
}

function parseFunction(value: unknown): NodeFunction | undefined {
    if (!isObject(value) || !isNonEmptyString(value.name) || typeof value.returnType !== 'string' || !Array.isArray(value.parameters)) {
        return undefined;
    }
    const kind = parseKind(value.kind);
    if (!kind) return undefined;
    const description = parseDescription(value.description);
    if (!description.ok) return undefined;
    const parameters: NodeFunction['parameters'] = [];
    for (const parameter of value.parameters) {
        if (!isObject(parameter) || !isNonEmptyString(parameter.name) || typeof parameter.type !== 'string') return undefined;
        const parameterDescription = parseDescription(parameter.description);
        if (!parameterDescription.ok) return undefined;
        parameters.push({ name: parameter.name, type: parameter.type, description: parameterDescription.value });
    }

    // Nodes refuse to register an inference function without it, so one that lacks it is malformed.
    if (kind === 'inference' && parameters.find((parameter) => parameter.name === MAX_TOKENS_PARAMETER)?.type !== 'int32') {
        return undefined;
    }
    const paymentManifest = parsePaymentManifest(value.paymentManifest, kind);
    if (!paymentManifest.ok) return undefined;
    // Nodes always price a contract, so every call needs a voucher.
    if (kind === 'contract' && (value.name !== CONTRACT_FUNCTION || !paymentManifest.value)) return undefined;

    return {
        name: value.name,
        returnType: value.returnType,
        description: description.value,
        parameters,
        paymentManifest: paymentManifest.value,
        restricted: value.restricted === true,
        kind,
    };
}

export function parseResource(value: unknown): NodeResource | undefined {
    const baseUrl = isObject(value) ? parseBaseUrl(value.baseUrl) : undefined;
    if (!isObject(value) || !isNonEmptyString(value.path) || !isNonEmptyString(value.name) || !baseUrl || !Array.isArray(value.functions)) {
        return undefined;
    }
    const website = parseWebsite(value.website);
    const description = parseDescription(value.description);
    if (!website.ok || !description.ok) return undefined;
    const functions: NodeFunction[] = [];
    const names = new Set<string>();
    for (const raw of value.functions) {
        const fn = parseFunction(raw);
        // A resource with a malformed or duplicate function is dropped whole, rather than shown with part of its API.
        if (!fn || names.has(fn.name)) return undefined;
        names.add(fn.name);
        functions.push(fn);
    }
    // A contract's resource has its one function and nothing else.
    if (functions.some((fn) => fn.kind === 'contract') && functions.length !== 1) return undefined;
    return { path: value.path, name: value.name, baseUrl, website: website.value, description: description.value, functions };
}

function parseContractParameters(value: unknown): NodeContract['parameters'] | undefined {
    if (!Array.isArray(value)) return undefined;
    const parameters: NodeContract['parameters'] = [];
    for (const parameter of value) {
        if (!isObject(parameter) || !isNonEmptyString(parameter.name) || !isNonEmptyString(parameter.type)) return undefined;
        parameters.push({ name: parameter.name, type: parameter.type });
    }
    return parameters;
}

export function parseContract(value: unknown): NodeContract | undefined {
    if (!isObject(value) || !isNonEmptyString(value.path) || !isNonEmptyString(value.name) || !isNonEmptyString(value.returnType)) return undefined;
    if (typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)) return undefined;
    if (typeof value.source !== 'string' || value.source.length === 0 || Buffer.byteLength(value.source) > MAX_CONTRACT_SOURCE_BYTES) return undefined;
    const parameters = parseContractParameters(value.parameters);
    if (!parameters) return undefined;
    const owner = value.ownerOrganizationId;
    if (owner !== null && !(isNonEmptyString(owner) && owner.length <= MAX_ORGANIZATION_ID_LENGTH)) return undefined;
    const description = parseDescription(value.description);
    if (!description.ok) return undefined;
    const createdAt = typeof value.createdAt === 'string' ? new Date(value.createdAt) : undefined;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return undefined;
    return {
        path: value.path,
        name: value.name,
        version: value.version,
        source: value.source,
        parameters,
        returnType: value.returnType,
        ownerOrganizationId: owner,
        description: description.value,
        createdAt,
    };
}

export class NodeClient {
    constructor(
        /** The node's base URL, without `/v1`. */
        readonly baseUrl: string,
        private readonly timeoutMs = 10_000,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    private async request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
        const url = `${this.baseUrl}/v1${path}`;
        let response: Response;
        try {
            response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
        } catch (error) {
            throw new NodeRequestError(`Request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            body = undefined;
        }
        return { status: response.status, body };
    }

    private async getJson(path: string): Promise<unknown> {
        const { status, body } = await this.request(path);
        if (status !== 200) {
            throw new NodeRequestError(`GET ${this.baseUrl}/v1${path} returned ${status}`, status);
        }
        return body;
    }

    async getSelf(): Promise<NodeSelf> {
        const self = parsePeer(await this.getJson('/self'));
        if (!self) throw new NodeRequestError(`${this.baseUrl}/v1/self returned an invalid identity`);
        return self;
    }

    /** Reads every page of a paged list route (`{ [key]: T[], nextOffset }`). */
    private async getAllPages(path: string, key: string): Promise<unknown[]> {
        const items: unknown[] = [];
        let offset: number | null = 0;
        for (let page = 0; offset !== null; page++) {
            if (page >= MAX_PAGES) throw new NodeRequestError(`${this.baseUrl}/v1${path} returned more than ${MAX_PAGES} pages`);
            const body = await this.getJson(`${path}?offset=${offset}&limit=${PAGE_SIZE}`);
            if (!isObject(body) || !Array.isArray(body[key])) {
                throw new NodeRequestError(`${this.baseUrl}/v1${path} returned an invalid page`);
            }
            items.push(...body[key]);
            const next: unknown = body.nextOffset;
            // Older nodes don't page, and omit nextOffset.
            offset = typeof next === 'number' && Number.isInteger(next) && next > offset ? next : null;
        }
        return items;
    }

    /** Every resource the node lists. Malformed entries are skipped and counted in `invalid`. */
    async getAllResources(): Promise<{ resources: NodeResource[]; invalid: number }> {
        const raw = await this.getAllPages('/resources', 'resources');
        const resources: NodeResource[] = [];
        for (const item of raw) {
            const resource = parseResource(item);
            if (resource) resources.push(resource);
        }
        return { resources, invalid: raw.length - resources.length };
    }

    /** Every version of every contract the node hosts, with its source. Malformed entries are skipped and counted in `invalid`. */
    async getAllContracts(): Promise<{ contracts: NodeContract[]; invalid: number }> {
        const raw = await this.getAllPages('/contracts', 'contracts');
        const contracts: NodeContract[] = [];
        for (const item of raw) {
            const contract = parseContract(item);
            if (contract) contracts.push(contract);
        }
        return { contracts, invalid: raw.length - contracts.length };
    }

    async getAllPeers(): Promise<NodePeer[]> {
        return (await this.getAllPages('/peers', 'peers')).flatMap((item) => parsePeer(item) ?? []);
    }

    /**
     * Calls a restricted function on this node without authorization. The node checks the grant
     * before running anything, and answers 403 with a `grantEndpoint` when it issues grants on request.
     * Only ever call this for a function the node lists as restricted: an open one would run.
     */
    async probeGrant(resourcePath: string, resourceName: string, functionName: string): Promise<GrantProbeResult> {
        const { status, body } = await this.request('/run/resource', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resourcePath, resourceName, functionName, parameters: [] }),
        });
        if (status !== 403) return { kind: 'unexpected', status };
        const grantEndpoint = isObject(body) && isNonEmptyString(body.grantEndpoint) ? body.grantEndpoint : null;
        return { kind: 'restricted', grantEndpoint };
    }
}
