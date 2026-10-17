#!/bin/sh
# Railway builds the last Dockerfile stage for every service and cannot pass --target.
# Which app runs is decided here, from APP, the service name, or the env that app requires.
# Compose never runs this; each service sets its own target.
set -eu

if [ -n "${APP:-}" ]; then
    choice=$(printf '%s' "$APP" | tr '[:upper:]' '[:lower:]')
else
    service=$(printf '%s' "${RAILWAY_SERVICE_NAME:-}" | tr '[:upper:]' '[:lower:]')
    case "$service" in
        web | *-web | *_web) choice=web ;;
        api | *-api | *_api) choice=api ;;
        *)
            if [ -n "${DATABASE_URL:-}" ]; then
                choice=api
            elif [ -n "${API_URL:-}" ]; then
                choice=web
            else
                choice=
            fi
            ;;
    esac
fi

case "$choice" in
    web)
        cd /app/apps/web
        exec ./node_modules/.bin/next start --hostname :: --port "${PORT:-3000}"
        ;;
    api)
        cd /app/apps/api
        exec node dist/server.js
        ;;
    *)
        echo "Refusing to start. Set APP=web or APP=api (service name: '${RAILWAY_SERVICE_NAME:-}')." >&2
        exit 1
        ;;
esac
