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

/** Costs `costLamports` per call, paid to `SAMPLE_RECIPIENT`. */
export const paid = (name: string, parameters: string, returnType: string, costLamports: number): FunctionSpec =>
    ({ ...open(name, parameters, returnType), paymentManifest: { costLamports, recipientAddress: SAMPLE_RECIPIENT } });

/** Callers need a grant from the hosting node. */
export const restricted = (fn: FunctionSpec): FunctionSpec => ({ ...fn, restricted: true });

/** Resources for the node the registry syncs from. Its host issues grants on request. */
export const SOURCE_RESOURCES: ResourceSpec[] = [
    { path: 'com.example', name: 'Weather', functions: [
        paid('temperature', 'city: string', 'int32', 10_000),
        paid('forecast', 'city: string, days: int32', 'string', 2_500),
        open('stations', '', '[]string'),
    ] },
    { path: 'com.example', name: 'Echo', functions: [
        open('echo', 'message: string', 'string'),
        open('reverse', 'message: string', 'string'),
    ] },
    { path: 'io.quallet.finance', name: 'Ledger', functions: [
        restricted(open('balance', 'account: string', 'int64')),
        restricted(paid('transfer', 'from: string, to: string, amount: int64', 'boolean', 5_000)),
        open('rates', '', 'string'),
    ] },
    { path: 'sh.stellarium.tools', name: 'Geocoder', functions: [
        paid('lookup', 'address: string', 'string', 1_000),
        paid('reverse', 'lat: float64, lon: float64', 'string', 1_000),
    ] },
];

/** Resources for a peer of the source node. Its host does not issue grants on request. */
export const PEER_RESOURCES: ResourceSpec[] = [
    { path: 'org.archive', name: 'Library', functions: [
        open('search', 'query: string, limit: int32', '[]string'),
        restricted(open('checkout', 'bookId: string', 'boolean')),
        paid('scan', 'bookId: string, page: int32', 'string', 7_500),
    ] },
    { path: 'org.archive.internal', name: 'Admin', functions: [
        restricted(open('purge', 'olderThanDays: int32', 'int32')),
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
