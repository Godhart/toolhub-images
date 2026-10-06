#!/bin/sh
# Run after build.sh base docker mcp-bridge. Does not start a daemon or mount its socket.
set -eu
engine=${1:-docker}
for variant in base docker; do
  "$engine" run --rm --network none --read-only --tmpfs /tmp:rw,mode=1777 \
    "toolhub-twylt:$variant" python -c 'import docker, toolhub_config; print("Domain runtime imports OK")'
  "$engine" run --rm --network none --read-only --tmpfs /tmp:rw,mode=1777 \
    "toolhub-twylt:$variant" toolhub-config --help
done
"$engine" run --rm --network none --read-only --tmpfs /tmp:rw,mode=1777 \
  toolhub-mcp-bridge:base --help
