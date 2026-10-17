# CLAUDE.md

A registry of Stellarium network resources. A pnpm + Turborepo monorepo: `apps/api` (Fastify, Postgres/Drizzle, sync worker), `apps/web` (Next.js App Router, CSS Modules, no Tailwind), `apps/local-source-node` and `apps/local-peer-node` (real stellarium-ts nodes for local runs), `packages/types` (`@registry/types`, the wire types the API and web share) and `packages/node-fixtures` (starts nodes with sample resources). `docker compose up -d --build` runs everything; `pnpm dev` runs the apps against `docker compose up -d postgres`. The README covers setup and how syncing works.

## Commands

```sh
pnpm build                     # turbo; packages/types must build before the apps type-check
pnpm test                      # api vitest (PGlite + fixture node; no Docker)
pnpm lint                      # biome lint (formatter disabled)
pnpm check-types
pnpm --filter api exec vitest run src/routes.test.ts -t "ranks"
```

**Schema changes** (`apps/api/src/db/schema.ts`) need a generated migration committed under `apps/api/drizzle/`. The API applies migrations at startup.
```sh
cd apps/api && pnpm exec drizzle-kit generate --name <change>
```
The first migration is a hand-written `CREATE EXTENSION pg_trgm`. The trigram search indexes depend on it.

## Conventions

- Source of truth for the node API is the stellarium-ts repo (`packages/stellarium-ts/src/routes.ts`). docs.stellarium.sh lags behind it. Tests and the local node apps run real nodes through `@registry/node-fixtures` (`packages/node-fixtures/src/index.ts`). Each node uses in-memory SQLite and a placeholder operator URL, since the registry never calls a paid function. To change a node's resources mid-test, restart it on the same port (`startSource` in `syncService.test.ts`).
- Remote node data is untrusted: `nodeClient.ts` validates every field and drops malformed resources rather than coercing them.
- Never send `POST /run/resource` for a function that isn't `restricted`: the node would run it. The grant probe relies on the 403 a restricted function returns before execution.
- Docker: one root `Dockerfile` builds the workspace once, with a runtime target per app. `.dockerignore` excludes `.env` files, and compose sets each service's environment. Inside compose, nodes advertise service-name URLs (`http://local-source-node:3100`), so those are the URLs the registry stores and shows.
- The API reads `process.env` only in `config.ts`. ESM with `.js` relative imports.
- Web: data fetching happens in server components through `lib/api.ts` (`server-only`). Theme tokens live in `app/globals.css` under `:root[data-theme]`. Ligatures are off so code renders as typed.
