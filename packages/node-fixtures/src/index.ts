// Real stellarium-ts nodes for the local node apps and the API's tests, plus sample resources
// that cover every combination the registry shows: free and paid, open and restricted, fixed, inference
// and contract.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import Fastify from 'fastify';
import { StellariumNode, type StellariumResource, type StellariumResourceFunction } from 'stellarium-ts';

/** The operator organization every fixture node is enrolled in, so the recipient of its paid functions. */
export const SAMPLE_ORGANIZATION = 'org_sample';

/** What every fixture node charges per million script tokens its contracts execute, as the operator reports it. */
export const SAMPLE_CONTRACT_PRICE = 2_000_000;

/** A function as declared, before the node gives it an implementation. */
export type FunctionSpec = Omit<StellariumResourceFunction, 'exec' | 'id'>;

export interface ResourceSpec {
    path: string;
    name: string;
    website?: string;
    description?: string;
    functions: FunctionSpec[];
}

const params = (spec: string) =>
    spec ? spec.split(',').map((pair) => {
        const [name, type] = pair.split(':').map((part) => part.trim());
        return { name, type };
    }) : [];

/** `open('echo', 'message: string', 'string')`: free, and anyone may call it. */
export const open = (name: string, parameters: string, returnType: string): FunctionSpec =>
    ({ name, parameters: params(parameters), returnType });

/** Costs `costMicroUsd` per call. The node names its organization as the recipient. */
export const paid = (name: string, parameters: string, returnType: string, costMicroUsd: number): FunctionSpec =>
    ({ ...open(name, parameters, returnType), paymentManifest: { costMicroUsd } });

/**
 * `inference('complete', 'prompt: string', 'string')`: free, priced per token with `perToken`.
 * Takes a `maxTokens: int32` parameter after the others, as every inference function must.
 */
export const inference = (name: string, parameters: string, returnType: string): FunctionSpec =>
    ({ ...open(name, parameters ? `${parameters}, maxTokens: int32` : 'maxTokens: int32', returnType), kind: 'inference' });

/** Prices an inference function per million input and output tokens. */
export const perToken = (fn: FunctionSpec, inputCostMicroUsdPerMillionTokens: number, outputCostMicroUsdPerMillionTokens: number): FunctionSpec => ({
    ...fn,
    paymentManifest: { inputCostMicroUsdPerMillionTokens, outputCostMicroUsdPerMillionTokens },
    // Required on a paid inference function. The registry never calls one, so nothing is counted.
    estimateInputTokens: async () => 0,
});

/** Callers need a grant from the hosting node. */
export const restricted = (fn: FunctionSpec): FunctionSpec => ({ ...fn, restricted: true });

/** Describes the function and, by name, any of its parameters. */
export const described = (fn: FunctionSpec, description: string, parameters: Record<string, string> = {}): FunctionSpec => ({
    ...fn,
    description,
    parameters: fn.parameters.map((parameter) => (parameter.name in parameters ? { ...parameter, description: parameters[parameter.name] } : parameter)),
});

/** Resources for the node the registry syncs from. Its host issues grants on request. */
export const SOURCE_RESOURCES: ResourceSpec[] = [
    { path: 'com.example', name: 'Weather', website: 'https://weather.example.com', description: 'Current conditions and forecasts for cities worldwide.', functions: [
        described(paid('temperature', 'city: string', 'int32', 10_000), 'The current temperature, in degrees Celsius.', { city: 'A city name, such as "Oslo".' }),
        described(paid('forecast', 'city: string, days: int32', 'string', 2_500), 'A daily forecast as JSON.', { city: 'A city name, such as "Oslo".', days: 'How many days ahead, from 1 to 7.' }),
        described(open('stations', '', '[]string'), 'IDs of the weather stations readings come from.'),
    ] },
    { path: 'com.example', name: 'Echo', description: 'Returns what you send it. Useful for testing a client.', functions: [
        described(open('echo', 'message: string', 'string'), 'Returns the message unchanged.', { message: 'Any text.' }),
        described(open('reverse', 'message: string', 'string'), 'Returns the message with its characters reversed.', { message: 'Any text.' }),
    ] },
    { path: 'io.quallet.finance', name: 'Ledger', website: 'https://ledger.example.com', description: 'Account balances and transfers. Balance and transfer calls need a grant.', functions: [
        restricted(described(open('balance', 'account: string', 'int64'), 'The account\'s balance, in lamports.', { account: 'The account ID.' })),
        restricted(described(paid('transfer', 'from: string, to: string, amount: int64', 'boolean', 5_000), 'Moves funds between two accounts. Returns false when the balance is too low.', {
            from: 'The account to debit.',
            to: 'The account to credit.',
            amount: 'How much to move, in lamports.',
        })),
        described(open('rates', '', 'string'), 'Current exchange rates as JSON.'),
    ] },
    { path: 'sh.stellarium.tools', name: 'Geocoder', website: 'https://geocoder.example.com', description: 'Converts between street addresses and coordinates.', functions: [
        described(paid('lookup', 'address: string', 'string', 1_000), 'The coordinates of an address, as "lat,lon".', { address: 'A street address, such as "1 Main St, Springfield".' }),
        described(paid('reverse', 'lat: float64, lon: float64', 'string', 1_000), 'The nearest street address to a point.', { lat: 'Latitude, in degrees.', lon: 'Longitude, in degrees.' }),
    ] },
    { path: 'ai.example', name: 'Assistant', website: 'https://assistant.example.com', description: 'Text generation, priced per token.', functions: [
        described(perToken(inference('complete', 'prompt: string', 'string'), 3_000_000, 15_000_000), 'Continues the prompt.', {
            prompt: 'The text to continue.',
            maxTokens: 'The most output tokens to generate.',
        }),
        described(inference('summarize', 'text: string', 'string'), 'A short summary of the text.', { text: 'The text to summarize.', maxTokens: 'The most output tokens to generate.' }),
    ] },
];

/** Resources for a peer of the source node. Its host does not issue grants on request. */
export const PEER_RESOURCES: ResourceSpec[] = [
    { path: 'org.archive', name: 'Library', website: 'https://archive.example.org', description: 'Search, check out and scan books from a library catalogue.', functions: [
        described(open('search', 'query: string, limit: int32', '[]string'), 'Book IDs matching a title or author.', { query: 'Words from a title or author.', limit: 'The most results to return.' }),
        restricted(described(open('checkout', 'bookId: string', 'boolean'), 'Checks out a book. Returns false when it is already out.', { bookId: 'A book ID from search.' })),
        described(paid('scan', 'bookId: string, page: int32', 'string', 7_500), 'The text of one scanned page.', { bookId: 'A book ID from search.', page: 'The page number, from 1.' }),
        // Output is free: callers pay only for the book text they send.
        restricted(described(perToken(inference('ask', 'bookId: string, question: string', 'string'), 1_000_000, 0), 'Answers a question about a book.', {
            bookId: 'A book ID from search.',
            question: 'What to ask about the book.',
            maxTokens: 'The most output tokens in the answer.',
        })),
    ] },
    { path: 'org.archive.internal', name: 'Admin', description: 'Maintenance tasks for the library\'s operators.', functions: [
        restricted(described(open('purge', 'olderThanDays: int32', 'int32'), 'Deletes expired checkouts. Returns how many it deleted.', { olderThanDays: 'Only checkouts that expired more than this many days ago.' })),
    ] },
];

/** A contract to deploy: RequestScript source declaring `contract path.Name@version(...): type`. */
export interface ContractSpec {
    source: string;
    description?: string;
}

/** Contracts for the node the registry syncs from. Outlook has two versions; calls run the second. */
export const SOURCE_CONTRACTS: ContractSpec[] = [
    {
        description: 'Today\'s weather in words.',
        source: `contract com.example.Outlook(city: string): string {
    const weather: com.example.Weather
    const today = weather.temperature(city: city)
    if (today.error != null) {
        return "unknown"
    }
    return "\${today.value} degrees"
}`,
    },
    {
        description: 'Today\'s weather in words, with a forecast.',
        source: `contract com.example.Outlook@2(city: string, days: int32): string {
    const weather: com.example.Weather
    const today = weather.temperature(city: city)
    if (today.error != null) {
        return "unknown"
    }
    const ahead = weather.forecast(city: city, days: days)
    if (ahead.error != null) {
        return "\${today.value} degrees"
    }
    return "\${today.value} degrees, then \${ahead.value}"
}`,
    },
];

/** Contracts for the peer node. Visits keeps state between calls. */
export const PEER_CONTRACTS: ContractSpec[] = [
    {
        description: 'Counts how often each book is viewed.',
        source: `contract org.archive.Visits(bookId: string): int32 {
    var state(bookId) views: int32 = 0

    views = views + 1
    return views
}`,
    },
];

export interface RunningNode {
    baseUrl: string;
    publicKey: string;
    /** `path.Name.function` for every call that reached a function body. */
    executed: string[];
    /** Deploys a contract with the node's API key. Throws if the node refuses it. */
    deployContract: (contract: ContractSpec) => Promise<void>;
    /** Deletes `path.Name@version`, or every version of `path.Name`. */
    deleteContract: (ref: string) => Promise<void>;
    close: () => Promise<void>;
}

export interface StartNodeOptions {
    resources: ResourceSpec[];
    /** Deployed in order once the node listens, before `startNode` resolves. */
    contracts?: ContractSpec[];
    /** Issue a grant to anyone who asks. Without it, the node refuses grant requests. */
    approveGrants?: boolean;
    /** Learn this node's peers and resources at start. */
    startingPeer?: string;
    /** Defaults to a free port. */
    port?: number;
    /** Interface to listen on. Defaults to 127.0.0.1. */
    host?: string;
    /** URL peers and the registry use to reach this node. Defaults to `http://{host}:{port}`. */
    baseUrl?: string;
    logger?: boolean;
}

/** A port nothing is listening on. The node needs its base URL before it listens. */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };
            server.close(() => resolve(port));
        });
    });
}

/**
 * Stands in for the operator. A node hosting paid functions asks for its organization at start and
 * won't start without one. The registry never calls a paid function, so every other request fails.
 */
async function startOperator(): Promise<{ url: string; close: () => Promise<void> }> {
    const operator = Fastify();
    operator.post('/v1/nodes/session', async () => ({ organizationId: SAMPLE_ORGANIZATION, priceMicroUsdPerMillionTokens: SAMPLE_CONTRACT_PRICE }));
    operator.setNotFoundHandler(async (_request, reply) => reply.code(503).send({ error: 'The fixture operator only enrolls nodes' }));
    const address = await operator.listen({ port: 0, host: '127.0.0.1' });
    return { url: `${address}/v1`, close: () => operator.close() };
}

export async function startNode(options: StartNodeOptions): Promise<RunningNode> {
    const port = options.port ?? await freePort();
    const host = options.host ?? '127.0.0.1';
    const baseUrl = (options.baseUrl ?? `http://${host}:${port}`).replace(/\/+$/, '');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    const executed: string[] = [];
    // Only this process deploys contracts, so a random key per node is enough.
    const apiKey = randomBytes(24).toString('base64url');

    const node = new StellariumNode();
    for (const [index, spec] of options.resources.entries()) {
        const resource: StellariumResource = {
            id: index + 1,
            baseUrl,
            metadata: {},
            path: spec.path,
            name: spec.name,
            website: spec.website,
            description: spec.description,
            functions: spec.functions.map((fn) => ({
                ...fn,
                exec: async () => {
                    executed.push(`${spec.path}.${spec.name}.${fn.name}`);
                    // An inference function reports the tokens it used alongside its value.
                    return fn.kind === 'inference' ? { value: null, usage: { inputTokens: 0, outputTokens: 0 } } : null;
                },
            })),
        };
        await node.register(resource);
    }

    const operator = await startOperator();
    // A deploy announces the node to its peers in the background, so a peer may still hold that connection
    // when it closes. Dropping every connection keeps close from waiting out the keep-alive.
    const fastify = Fastify({ logger: options.logger ?? false, forceCloseConnections: true });
    fastify.addHook('onClose', operator.close);
    // `start` listens before it bootstraps, so a failed bootstrap would otherwise keep the port.
    await node.start(fastify, {
        port,
        host,
        baseUrl,
        publicKey: publicKey.toString('base64url'),
        privateKey: privateKey.toString('base64url'),
        databasePath: ':memory:',
        startingPeer: options.startingPeer,
        operatorUrl: operator.url,
        apiKey,
        approveGrant: options.approveGrants ? async () => ({ lifetimeMs: 60 * 60_000 }) : undefined,
    }).catch(async (error: unknown) => {
        await fastify.close();
        throw error;
    });

    // The node's own address, since `baseUrl` may be a name only other containers resolve.
    const local = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}/v1/contracts`;
    const admin = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(`${local}${path}`, {
            method,
            headers: { authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`${method} /v1/contracts${path} returned ${response.status}: ${await response.text()}`);
    };
    const deployContract = (contract: ContractSpec) => admin('POST', '', contract);
    const deleteContract = (ref: string) => admin('DELETE', `/${encodeURIComponent(ref)}`);

    try {
        for (const contract of options.contracts ?? []) await deployContract(contract);
    } catch (error) {
        await fastify.close();
        throw error;
    }

    return { baseUrl, publicKey: publicKey.toString('base64url'), executed, deployContract, deleteContract, close: () => fastify.close() };
}
