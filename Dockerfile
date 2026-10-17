# One build stage for the whole workspace, then a runtime target per app:
#   docker compose up --build    (see compose.yaml; each service sets `target:`)
# Railway builds the last stage and cannot pass --target. That stage starts api or
# web from APP, the service name, or DATABASE_URL / API_URL (docker/railway-start.sh).
FROM node:22-trixie-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate

WORKDIR /app

FROM base AS build

# sqlite3 (used by stellarium-ts) builds from source when no prebuilt binary matches.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app

FROM runtime AS api
WORKDIR /app/apps/api
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/server.js"]

FROM runtime AS web
WORKDIR /app/apps/web
EXPOSE 3000
# Run Next directly: `pnpm start` would make corepack fetch pnpm on every container start.
# Honor $PORT (Railway injects it). Compose leaves PORT unset, so this stays on 3000.
# Bind :: so the process accepts IPv4 and IPv6; Railway private DNS uses both.
CMD ["sh", "-c", "exec node_modules/.bin/next start --hostname :: --port ${PORT:-3000}"]

FROM runtime AS local-source-node
WORKDIR /app/apps/local-source-node
ENV HOST=0.0.0.0 PORT=3100
EXPOSE 3100
CMD ["node", "dist/server.js"]

FROM runtime AS local-peer-node
WORKDIR /app/apps/local-peer-node
ENV HOST=0.0.0.0 PORT=3101
EXPOSE 3101
CMD ["node", "dist/server.js"]

# Railway's image. Compose targets above never reach this command.
FROM runtime
CMD ["sh", "/app/docker/railway-start.sh"]
