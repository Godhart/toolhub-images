#!/bin/sh
set -eu
mkdir -p "$HOME" "$XDG_CACHE_HOME"
if [ "${1:-}" = toolhub ]; then
    shift
    cd /opt/toolhub
    # Refuses destructive schema changes; never uses --accept-data-loss.
    bun run db:push --skip-generate
    bun run /opt/toolhub/container-init.ts
    unset TOOLHUB_ADMIN_PASSWORD TOOLHUB_AGENT_PASSWORD
    exec bun run apps/api/src/index.ts "$@"
fi
exec "$@"
