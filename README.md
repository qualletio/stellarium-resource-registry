# stellarium-resource-registry

A public registry of the Resources on the [Stellarium](https://docs.stellarium.sh) network. Anyone can search resources by path, name or function name, and see each resource's description and website, each function's signature and description, its kind (fixed, `inference` for AI inference, or `contract`), its price (from its `paymentManifest`: per call, per million input and output tokens for an inference function, or per million script tokens executed for a contract) and its access (`restricted`, and whether the hosting node issues grants on request). For a contract, a RequestScript script deployed to a node, it also shows every deployed version and its source.

## Layout

| Package | What it is |
| - | - |
| `apps/api` | Fastify + Postgres/Drizzle. Syncs resources from one Stellarium node on an interval and serves them at `/v1`. Port 4000. |
| `apps/web` | Next.js (App Router, CSS Modules) with a terminal look and light/dark themes. Reads the API on the server. Port 3000. |
| `apps/local-source-node` | A real stellarium-ts node the registry syncs from (:3100). Bootstraps from the peer and issues grants on request. |
| `apps/local-peer-node` | A real stellarium-ts node hosting `org.archive.*` (:3101), including the `org.archive.Visits` contract. Refuses grant requests. |
| `packages/types` | `@registry/types`: the API's wire types, shared by both apps. |
| `packages/node-fixtures` | `@registry/node-fixtures`: starts stellarium-ts nodes with sample resources (free, paid, restricted, and paid-and-restricted, plus free and per-token inference functions, and contracts it deploys with the node's API key). Used by the local node apps and the API tests. |

## Running locally

### Everything in Docker

```sh
docker compose up -d --build
```

This starts Postgres, both local nodes, the API and the web app, each waiting for what it depends on. Open http://localhost:3000. The API is on http://localhost:4000/v1, and `POST /v1/sync` takes `Authorization: Bearer local-admin-key` (override with `ADMIN_API_KEY`). `docker compose down` stops it all and keeps the database volume.

### Development

Requires Node 20+, pnpm (version pinned in `package.json`, via corepack) and Docker for Postgres.

```sh
pnpm install
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
pnpm dev        # web :3000, api :4000, source node :3100, peer node :3101
```

The source node waits for the peer, then bootstraps from it, so syncing :3100 shows both nodes' resources. The API migrates the database and syncs as soon as it starts, then every `SYNC_INTERVAL_MS`. Its first sync can run before the nodes are up; trigger one with `POST /v1/sync` or wait for the next.

In production, set the web app's `SITE_URL` to its public origin (for example `https://registry.stellarium.sh`). It builds the canonical links, `/sitemap.xml` and `/robots.txt`. On Railway it falls back to the service's public domain.

To sync a real network instead, set `SYNC_NODE_URL` to any stellarium-ts node. For example, the stellarium-ts repo's `docker compose` runs one on `http://127.0.0.1:3002`.

## How syncing works

Each run reads the source node's public routes, `GET /v1/self`, `/v1/resources` and `/v1/peers` (paged), and copies them into Postgres:

- Resources are keyed by fully qualified name (`path.Name`). Functions, parameters (with their descriptions) and payment manifests are rewritten only when they change. A resource's own description and website are updated on every sync.
- A resource the node stops listing gets `removed_at` set rather than being deleted. It disappears from search, and its page shows a warning. Nodes the source stops listing are dropped once they host no live resources.
- **Grant probe.** Who holds a grant is private to the nodes involved, so the registry can only learn whether a host issues grants on request. For each host with a restricted function, it calls one restricted function without authorization (at most once per `GRANT_PROBE_INTERVAL_MS`). The node refuses with 403 before running anything, and includes a `grantEndpoint` if it accepts requests. Open functions are never probed, since calling one would run it.
- **Contracts.** A contract is listed as a resource with one function, `run`, which only describes its latest version. For each live contract, the registry reads `GET /v1/contracts` (paged) from the node that hosts it, since the source node only lists its own, and stores every version with its source in `contract_versions`. A host is only believed about the contracts it hosts. Each sync mirrors the host's list, so deleted versions disappear; a host that can't be read keeps the versions stored before. The latest version is the highest version number, as the node picks it. Sources over 256 KiB are dropped.
- Every run is logged in `sync_runs` (the last 1,000 are kept) and listed by `GET /v1/sync/runs`.

## API

| Route | |
| - | - |
| `GET /v1/stats` | Counts and the last successful sync |
| `GET /v1/resources?q=&in=all\|path\|name\|function&paid=&restricted=&inference=&contract=&offset=&limit=` | Search. Exact names rank first, then prefixes, then substrings |
| `GET /v1/resources/:fqn` | Functions, kinds, prices, access and the host's grant info. For a contract, `contract` has its versions, newest first, and the latest version's source |
| `GET /v1/resources/:fqn/versions/:version` | One version of a contract, with its source |
| `GET /v1/nodes` | Source node, peers and hosts |
| `GET /v1/sync/runs?limit=` | Recent sync runs |
| `POST /v1/sync` | Sync now. Requires `Authorization: Bearer $ADMIN_API_KEY` |

## Development

```sh
pnpm build && pnpm check-types && pnpm test && pnpm lint
```

API tests run against in-memory Postgres (PGlite, with `pg_trgm`) and real `stellarium-ts` nodes started in-process on local ports (`apps/api/src/fixtures/stellariumNodes.ts`), so they need no Docker. The same package backs the local node apps.
