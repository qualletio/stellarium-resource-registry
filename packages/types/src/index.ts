/**
 * The registry API's wire types, shared by `apps/api` (which produces them) and `apps/web` (which reads them).
 * Timestamps are ISO 8601 strings. Prices are integer micro-USDC (1 USDC = 1,000,000).
 */

/** Which fields a search matches against. */
export const SEARCH_FIELDS = ['all', 'path', 'name', 'function'] as const;
export type SearchField = typeof SEARCH_FIELDS[number];

export interface SearchQuery {
    q?: string;
    in?: SearchField;
    /** Only resources with at least one paid function. */
    paid?: boolean;
    /** Only resources with at least one restricted function. */
    restricted?: boolean;
    /** Only resources with at least one inference function. */
    inference?: boolean;
    offset?: number;
    limit?: number;
}

/** One page of results. `nextOffset` is null on the last page, like a Stellarium node's own paging. */
export interface Page<T> {
    items: T[];
    nextOffset: number | null;
}

export interface PriceRange {
    minMicroUsdc: number;
    maxMicroUsdc: number;
}

export interface ResourceSummary {
    /** `path.name`, the resource's fully qualified name. */
    fqn: string;
    path: string;
    name: string;
    baseUrl: string;
    /** The resource's own description, as its node lists it. */
    description: string | null;
    functionCount: number;
    /** Names of the functions that matched the search. Empty when the match was on path or name. */
    matchedFunctions: string[];
    /** Per-call prices of the fixed functions. Null when none is paid. */
    price: PriceRange | null;
    /** Paid functions of either kind. */
    paidFunctionCount: number;
    /** Paid inference functions, priced per token rather than per call, so not in `price`. */
    perTokenFunctionCount: number;
    restrictedFunctionCount: number;
    inferenceFunctionCount: number;
    lastSeenAt: string;
    /** Set when the source node stopped listing the resource. */
    removedAt: string | null;
}

export interface FunctionParameter {
    name: string;
    type: string;
    description: string | null;
}

/** A fixed function's `paymentManifest`: a flat price per call. */
export interface FixedPaymentManifest {
    costMicroUsdc: number;
    recipientAddress: string;
}

/** An inference function's `paymentManifest`: rates per million tokens. Either may be 0. */
export interface InferencePaymentManifest {
    inputCostMicroUsdcPerMillionTokens: number;
    outputCostMicroUsdcPerMillionTokens: number;
    recipientAddress: string;
}

/** A function's `paymentManifest`, as the hosting node publishes it. Its shape follows the function's `kind`. */
export type PaymentManifest = FixedPaymentManifest | InferencePaymentManifest;

export const FUNCTION_KINDS = ['fixed', 'inference'] as const;
/** Fixed functions have a flat price. Inference functions run AI inference, take `maxTokens` and are priced per token. */
export type FunctionKind = typeof FUNCTION_KINDS[number];

export const isInferenceManifest = (manifest: PaymentManifest): manifest is InferencePaymentManifest =>
    'inputCostMicroUsdcPerMillionTokens' in manifest;

export interface ResourceFunction {
    name: string;
    returnType: string;
    description: string | null;
    parameters: FunctionParameter[];
    /** Null for a free function. */
    paymentManifest: PaymentManifest | null;
    /** Callers need a grant from the hosting node. */
    restricted: boolean;
    kind: FunctionKind;
}

export interface NodeInfo {
    baseUrl: string;
    name: string | null;
    publicKey: string | null;
    /** The node the registry syncs from. */
    isSource: boolean;
    /** Whether the node issues grants on request. Null until a restricted function on it has been probed. */
    acceptsGrantRequests: boolean | null;
    /** Where callers ask this node for a grant, when it accepts requests. */
    grantEndpoint: string | null;
    grantProbedAt: string | null;
    lastSeenAt: string;
}

export interface NodeSummary extends NodeInfo {
    /** Live resources hosted on the node. */
    resourceCount: number;
}

export interface ResourceDetail {
    fqn: string;
    path: string;
    name: string;
    baseUrl: string;
    /** An http(s) URL where callers can learn more about the resource. */
    website: string | null;
    description: string | null;
    functions: ResourceFunction[];
    /** The node hosting the resource, when the registry knows it. */
    host: NodeInfo | null;
    firstSeenAt: string;
    lastSeenAt: string;
    removedAt: string | null;
}

export interface SyncRun {
    id: number;
    sourceUrl: string;
    status: 'running' | 'succeeded' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    resourcesSeen: number;
    resourcesAdded: number;
    resourcesRemoved: number;
    error: string | null;
}

export interface Stats {
    resources: number;
    functions: number;
    paidFunctions: number;
    restrictedFunctions: number;
    inferenceFunctions: number;
    nodes: number;
    sourceUrl: string;
    lastSync: SyncRun | null;
}

export interface ApiError {
    error: string;
}
