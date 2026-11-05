// A peer of the source node, hosting org.archive.* resources, the org.archive.Book struct, the org.archive.Visits contract and the org.archive.BookReturned event. It
// refuses grant requests, so the registry shows its restricted functions as needing a grant issued out of band.
import { PEER_CONTRACTS, PEER_EVENTS, PEER_EVENT_CONTRACTS, PEER_RESOURCES, PEER_STRUCTS, startNode } from '@registry/node-fixtures';

const node = await startNode({
    resources: PEER_RESOURCES,
    structs: PEER_STRUCTS,
    events: PEER_EVENTS,
    contracts: [...PEER_CONTRACTS, ...PEER_EVENT_CONTRACTS],
    port: Number(process.env.PORT ?? 3101),
    host: process.env.HOST ?? '127.0.0.1',
    baseUrl: process.env.BASE_URL,
    logger: true,
});
console.log(`Peer node listening, reachable at ${node.baseUrl}`);

const shutdown = () => node.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
