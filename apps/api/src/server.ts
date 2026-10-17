import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { SyncService } from './sync/syncService.js';

const config = loadConfig();

const db = drizzle(config.databaseUrl);
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

const syncService = new SyncService(db, {
    sourceUrl: config.syncNodeUrl,
    grantProbeIntervalMs: config.grantProbeIntervalMs,
});

const fastify = await buildApp({
    db,
    syncService,
    sourceUrl: config.syncNodeUrl,
    adminApiKey: config.adminApiKey,
    webOrigin: config.webOrigin,
    logger: { redact: ['req.headers.authorization'] },
});

try {
    await migrate(db, { migrationsFolder });
} catch (error) {
    fastify.log.error(error);
    process.exit(1);
}
fastify.log.info('Applied database migrations');

syncService.logger = fastify.log;

if (!config.adminApiKey) {
    fastify.log.warn('ADMIN_API_KEY is not set: POST /v1/sync will reject every request');
}

// Sync now, then on an interval. `sync()` joins a run already in progress, so runs never overlap.
const runSync = () => syncService.sync().catch((error) => fastify.log.error(error, 'Sync crashed'));
void runSync();
const syncTimer = setInterval(runSync, config.syncIntervalMs);
syncTimer.unref();
fastify.addHook('onClose', async () => clearInterval(syncTimer));

try {
    const address = await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`Registry API listening on ${address}, syncing from ${config.syncNodeUrl}`);
} catch (error) {
    fastify.log.error(error);
    process.exit(1);
}
