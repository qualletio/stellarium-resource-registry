// The node the registry syncs from. It bootstraps from STARTING_PEER, so it lists the peer's
// resources alongside its own, and it issues grants to anyone who asks.
import { setTimeout as sleep } from 'node:timers/promises';
import { SOURCE_RESOURCES, startNode } from '@registry/node-fixtures';

// Defaults to the local peer node. Set STARTING_PEER to an empty string to run standalone.
const startingPeer = (process.env.STARTING_PEER ?? 'http://127.0.0.1:3101').replace(/\/+$/, '') || undefined;

/** The node bootstraps once, at start, so wait until the peer answers rather than start without it. */
async function waitForPeer(baseUrl: string) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(`${baseUrl}/v1/`, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) return;
        } catch {
            // Not up yet.
        }
        if (attempt % 5 === 1) console.log(`Waiting for starting peer ${baseUrl}...`);
        await sleep(1_000);
    }
}

if (startingPeer) await waitForPeer(startingPeer);

const node = await startNode({
    resources: SOURCE_RESOURCES,
    approveGrants: true,
    startingPeer,
    port: Number(process.env.PORT ?? 3100),
    host: process.env.HOST ?? '127.0.0.1',
    baseUrl: process.env.BASE_URL,
    logger: true,
});
console.log(`Source node listening, reachable at ${node.baseUrl}${startingPeer ? `, peered with ${startingPeer}` : ''}`);

const shutdown = () => node.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
