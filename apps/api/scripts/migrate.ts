import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// The server also migrates at startup. This applies migrations without starting it.
const db = drizzle(process.env.DATABASE_URL as string);
await migrate(db, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle') });
await db.$client.end();
console.log('Applied database migrations');
