#!/bin/sh
set -eu
cd "$(dirname "$0")"
engine=${CONTAINER_ENGINE:-docker}
if [ "$#" -eq 0 ]; then set -- base essential git docker docs hdl docsanity mcp-bridge; fi
for target in "$@"; do
    case "$target" in
        base|essential|git|docker|docs|hdl|docsanity|okf) tag="toolhub-twylt:$target" ;;
        mcp-bridge) tag=toolhub-mcp-bridge:base ;;
        *) echo "Unknown build target: $target" >&2; exit 2 ;;
    esac
    "$engine" build --target "$target" -t "$tag" .
done
