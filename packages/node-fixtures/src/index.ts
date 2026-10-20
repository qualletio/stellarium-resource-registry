// Real stellarium-ts nodes for the local node apps and the API's tests, plus sample resources
// that cover every combination the registry shows: free and paid, open and restricted.
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import Fastify from 'fastify';
import { StellariumNode, type StellariumResource, type StellariumResourceFunction } from 'stellarium-ts';

export const SAMPLE_RECIPIENT = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

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

/** Costs `costMicroUsdc` per call, paid to `SAMPLE_RECIPIENT`. */
export const paid = (name: string, parameters: string, returnType: string, costMicroUsdc: number): FunctionSpec =>
    ({ ...open(name, parameters, returnType), paymentManifest: { costMicroUsdc, recipientAddress: SAMPLE_RECIPIENT } });

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
];

/** Resources for a peer of the source node. Its host does not issue grants on request. */
export const PEER_RESOURCES: ResourceSpec[] = [
    { path: 'org.archive', name: 'Library', website: 'https://archive.example.org', description: 'Search, check out and scan books from a library catalogue.', functions: [
        described(open('search', 'query: string, limit: int32', '[]string'), 'Book IDs matching a title or author.', { query: 'Words from a title or author.', limit: 'The most results to return.' }),
        restricted(described(open('checkout', 'bookId: string', 'boolean'), 'Checks out a book. Returns false when it is already out.', { bookId: 'A book ID from search.' })),
        described(paid('scan', 'bookId: string, page: int32', 'string', 7_500), 'The text of one scanned page.', { bookId: 'A book ID from search.', page: 'The page number, from 1.' }),
    ] },
    { path: 'org.archive.internal', name: 'Admin', description: 'Maintenance tasks for the library\'s operators.', functions: [
        restricted(described(open('purge', 'olderThanDays: int32', 'int32'), 'Deletes expired checkouts. Returns how many it deleted.', { olderThanDays: 'Only checkouts that expired more than this many days ago.' })),
    ] },
];

export interface RunningNode {
    baseUrl: string;
    publicKey: string;
    /** `path.Name.function` for every call that reached a function body. */
    executed: string[];
    close: () => Promise<void>;
}

export interface StartNodeOptions {
    resources: ResourceSpec[];
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

export async function startNode(options: StartNodeOptions): Promise<RunningNode> {
    const port = options.port ?? await freePort();
    const host = options.host ?? '127.0.0.1';
    const baseUrl = (options.baseUrl ?? `http://${host}:${port}`).replace(/\/+$/, '');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    const executed: string[] = [];

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
                    return null;
                },
            })),
        };
        await node.register(resource);
    }

    const fastify = Fastify({ logger: options.logger ?? false });
    // `start` listens before it bootstraps, so a failed bootstrap would otherwise keep the port.
    await node.start(fastify, {
        port,
        host,
        baseUrl,
        publicKey: publicKey.toString('base64url'),
        privateKey: privateKey.toString('base64url'),
        databasePath: ':memory:',
        startingPeer: options.startingPeer,
        // Required once a node hosts paid functions. The registry never calls one, so nothing settles.
        operatorUrl: 'http://127.0.0.1:9/v1',
        approveGrant: options.approveGrants ? async () => ({ lifetimeMs: 60 * 60_000 }) : undefined,
    }).catch(async (error: unknown) => {
        await fastify.close();
        throw error;
    });

    return { baseUrl, publicKey: publicKey.toString('base64url'), executed, close: () => fastify.close() };
}
