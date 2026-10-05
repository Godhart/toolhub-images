#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME" "$XDG_CACHE_HOME"
# Empty private workspace for Docker workers explicitly configured without host binds.
if [ "${TWYLT_WORKSPACE_ROOT:-}" = /tmp/docker-workspace ]; then
    mkdir -p /tmp/docker-workspace
fi
if [ "${1:-}" = toolhub ]; then
    shift
    cd /opt/toolhub
    if [ -n "${TOOLHUB_CONFIG:-}" ]; then
        if [ "$#" -ne 0 ]; then echo 'Configured startup does not accept extra arguments' >&2; exit 2; fi
        case "$DATABASE_URL" in file:/*) database=${DATABASE_URL#file:} ;; *) echo 'Expected absolute SQLite DATABASE_URL' >&2; exit 2 ;; esac
        case "$database" in *\?*|*\#*) echo 'SQLite query/fragment not supported' >&2; exit 2 ;; esac
        set -- --config "$TOOLHUB_CONFIG"
        if [ -n "${TOOLHUB_CONFIG_MODE:-}" ]; then set -- "$@" --mode "$TOOLHUB_CONFIG_MODE"; fi
        toolhub-config validate "$@"
        # The loader initializes the schema, applies configuration under a lifetime
        # lock, supervises the API and forwards shutdown to its process group.
        exec toolhub-config serve "$@" --database "$database" --toolhub-dir /opt/toolhub --init-schema
    fi
    # Refuses destructive schema changes; never uses --accept-data-loss.
    bun run db:push --skip-generate
    bun run /opt/toolhub/container-init.ts
    unset TOOLHUB_ADMIN_PASSWORD TOOLHUB_AGENT_PASSWORD
    exec bun run apps/api/src/index.ts "$@"
fi
exec "$@"
