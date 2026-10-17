import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Database } from './db/database.js';
import { RegistryRepository } from './registry/registryRepository.js';
import routes from './routes.js';
import type { SyncService } from './sync/syncService.js';

export interface AppOptions {
    db: Database;
    syncService: SyncService;
    sourceUrl: string;
    adminApiKey: string | undefined;
    webOrigin: string;
    rateLimitMax?: number;
    logger?: FastifyServerOptions['logger'];
}

/** The API without listening or background sync, so tests can drive it with `inject`. */
export async function buildApp(options: AppOptions) {
    const fastify = Fastify({
        logger: options.logger ?? false,
        // Query flags like `?paid=true` arrive as strings; Ajv coerces them to the schema's types.
        ajv: { customOptions: { coerceTypes: true, removeAdditional: true } },
    });

    await fastify.register(cors, { origin: options.webOrigin, methods: ['GET', 'POST'] });
    // Limits are per client IP.
    await fastify.register(rateLimit, { max: options.rateLimitMax ?? 300, timeWindow: '1 minute' });

    await fastify.register(routes, {
        prefix: '/v1',
        repository: new RegistryRepository(options.db, options.sourceUrl),
        syncService: options.syncService,
        adminApiKey: options.adminApiKey,
    });

    return fastify;
}
