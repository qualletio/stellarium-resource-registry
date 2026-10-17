// Shared fixtures for the API's tests. Not imported by production code.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from './db/database.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** An in-memory Postgres with pg_trgm and the committed migrations applied. */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
    const client = new PGlite({ extensions: { pg_trgm } });
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as Database, close: () => client.close() };
}
