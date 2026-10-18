export interface Config {
    databaseUrl: string;
    /** Base URL of the Stellarium node to sync from, without the `/v1` prefix. */
    syncNodeUrl: string;
    syncIntervalMs: number;
    grantProbeIntervalMs: number;
    /** Bearer token for `POST /v1/sync`. Manual syncs are refused when unset. */
    adminApiKey: string | undefined;
    webOrigin: string;
    port: number;
    host: string;
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer, got "${value}"`);
    }
    return parsed;
}

/** The only place the API reads `process.env`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const syncNodeUrl = env.SYNC_NODE_URL;
    if (!syncNodeUrl) throw new Error('SYNC_NODE_URL is required');

    return {
        databaseUrl,
        syncNodeUrl: syncNodeUrl.replace(/\/+$/, ''),
        syncIntervalMs: positiveInt('SYNC_INTERVAL_MS', env.SYNC_INTERVAL_MS, 2 * 60 * 60_000),
        grantProbeIntervalMs: positiveInt('GRANT_PROBE_INTERVAL_MS', env.GRANT_PROBE_INTERVAL_MS, 60 * 60_000),
        adminApiKey: env.ADMIN_API_KEY || undefined,
        webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3000',
        port: positiveInt('PORT', env.PORT, 4000),
        host: env.HOST ?? '0.0.0.0',
    };
}
