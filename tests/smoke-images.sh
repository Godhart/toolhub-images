#!/bin/sh
set -eu
engine=${1:-docker}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for variant in base git docs hdl okf; do
  "$engine" run --rm --network none --read-only --tmpfs /tmp:rw,mode=1777 \
    "toolhub-twylt:$variant" python -c 'import twylt, pydantic, yaml, tomli_w, markdown_it, charset_normalizer; print("Python OK")'
  "$engine" run --rm --network none --read-only --tmpfs /tmp:rw,mode=1777 \
    -v "$root/tests:/tools:ro" "toolhub-twylt:$variant" \
    tsx /tools/echo.mts '{"text":"OK"}'
done
"$engine" run --rm toolhub-twylt:git git --version
"$engine" run --rm toolhub-twylt:docs sh -ec 'mkdocs --version; sphinx-build --version; pandoc --version; dot -V; doxygen --version; typedoc --version'
"$engine" run --rm toolhub-twylt:hdl hdl-order --help
"$engine" run --rm --network none toolhub-twylt:okf okf-workspace --version
"$engine" run --rm --network none --read-only --tmpfs /tmp:rw,mode=1777 \
  -v "$root/tools:/tools:ro" toolhub-twylt:okf \
  python /tools/okf_workspace/run.py '{"operation":"describe_tools"}' 
# Temporary test data only. No production ports or volumes are used.
data=$(mktemp -d)
chmod 777 "$data"
name="toolhub-smoke-$$"
cleanup() { "$engine" rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT HUP INT TERM
"$engine" run -d --name "$name" --network none --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777 --cap-drop ALL \
  --security-opt no-new-privileges -v "$data:/data" \
  -e TOOLHUB_ADMIN_PASSWORD=smoke-only-admin \
  -e TOOLHUB_AGENT_PASSWORD=smoke-only-agent toolhub-twylt:base
ready=0
for n in $(seq 1 30); do
  if "$engine" exec "$name" node -e 'fetch("http://127.0.0.1:3000/admin/").then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))'; then
    ready=1; break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then "$engine" logs "$name"; exit 1; fi
"$engine" exec "$name" sh -ec 'cd /opt/toolhub; bun run container-init.ts; bun run container-init.ts'
"$engine" exec "$name" sh -ec 'cd /opt/toolhub; bun -e '\''const {PrismaClient}=require("@prisma/client"); const p=new PrismaClient(); if(await p.systemSetting.count()!==1 || await p.runner.count({where:{type:{startsWith:"twylt_"}}})!==2) process.exit(1); await p.$disconnect();'\'''
printf '%s\n' 'All image smoke tests passed.'
