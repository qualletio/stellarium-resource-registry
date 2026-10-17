import { createHash, timingSafeEqual } from 'node:crypto';
import { SEARCH_FIELDS, type SearchField } from '@registry/types';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { RegistryRepository } from './registry/registryRepository.js';
import { toSyncRun } from './registry/registryRepository.js';
import type { SyncService } from './sync/syncService.js';

interface RouteOptions {
    repository: RegistryRepository;
    syncService: SyncService;
    adminApiKey: string | undefined;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

interface SearchQuerystring {
    q?: string;
    in: SearchField;
    paid: boolean;
    restricted: boolean;
    offset: number;
    limit: number;
}

const searchQuerySchema = {
    type: 'object',
    properties: {
        q: { type: 'string', maxLength: 200 },
        in: { type: 'string', enum: SEARCH_FIELDS, default: 'all' },
        paid: { type: 'boolean', default: false },
        restricted: { type: 'boolean', default: false },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
    },
} as const;

const fqnParamsSchema = {
    type: 'object',
    required: ['fqn'],
    properties: { fqn: { type: 'string', minLength: 3, maxLength: 512 } },
} as const;

const syncRunsQuerySchema = {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
} as const;

/** Constant-time comparison. Hashing first gives equal-length buffers for timingSafeEqual. */
function secretsEqual(a: string, b: string): boolean {
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(a), digest(b));
}

const routes: FastifyPluginAsync<RouteOptions> = async (fastify, options) => {
    const { repository, syncService } = options;

    /** Requires `Authorization: Bearer <ADMIN_API_KEY>`. Refuses everything when no key is configured. */
    const requireAdminKey = async (request: FastifyRequest, reply: FastifyReply) => {
        const [scheme, token] = (request.headers.authorization ?? '').split(' ');
        if (!options.adminApiKey || scheme !== 'Bearer' || !token || !secretsEqual(token, options.adminApiKey)) {
            return reply.status(401).send({ error: 'Invalid API key' });
        }
    };

    fastify.get('/health', async () => ({ ok: true }));

    fastify.get('/stats', async () => repository.getStats());

    fastify.get('/resources', { schema: { querystring: searchQuerySchema } }, async (request) => {
        const query = request.query as SearchQuerystring;
        return repository.search({ ...query, in: query.in });
    });

    fastify.get('/resources/:fqn', { schema: { params: fqnParamsSchema } }, async (request, reply) => {
        const { fqn } = request.params as { fqn: string };
        const resource = await repository.getResource(fqn);
        if (!resource) {
            return reply.status(404).send({ error: 'Resource not found' });
        }
        return resource;
    });

    fastify.get('/nodes', async () => ({ items: await repository.getNodes() }));

    fastify.get('/sync/runs', { schema: { querystring: syncRunsQuerySchema } }, async (request) => {
        const { limit } = request.query as { limit: number };
        return { items: await repository.getSyncRuns(limit) };
    });

    /** Runs a sync now, or waits for the one in progress, and returns its run. */
    fastify.post('/sync', { preValidation: requireAdminKey, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async () => {
        return toSyncRun(await syncService.sync());
    });
};

export default routes;
