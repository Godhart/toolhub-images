#!/bin/sh
# Six mounted tools, actual loopback ICMP, no outbound network or Linux capabilities.
set -eu
pack=$(CDPATH= cd -- "${1:?Usage: smoke-essential-image.sh PACK_DIR [docker|podman]}" && pwd)
engine=${2:-docker}
workspace=$(mktemp -d)
trap 'rm -rf "$workspace"' EXIT HUP INT TERM
chmod 777 "$workspace"
"$engine" run --rm -i --network none --read-only --user 1000:1000 \
  --tmpfs /tmp:rw,mode=1777 --cap-drop ALL --security-opt no-new-privileges \
  --sysctl 'net.ipv4.ping_group_range=1000 1000' \
  -v "$pack:/tools/essential:ro" -v "$workspace:/workspace" \
  -e TWYLT_WORKSPACE_ROOT=/workspace -e TWYLT_ESSENTIAL_DISABLE_NETWORK=0 \
  toolhub-twylt:essential python - <<'PY'
import json, subprocess, sys
from pathlib import Path

def call(name,payload):
    result=subprocess.run([sys.executable,str(Path('/tools/essential/tools')/name/'run.py'),json.dumps(payload)],
                          capture_output=True,text=True,timeout=15)
    assert result.returncode==0,(name,result.stdout,result.stderr)
    return json.loads(result.stdout)

for name in ['echo','sleep','wget','curl','ping','web_search']:
    assert call(name,{'describe':'json_spec'})['name']==name
assert call('echo',{'text':'essential smoke'})=={'text':'essential smoke'}
assert call('sleep',{'seconds':0})['requested_seconds']==0
assert call('ping',{'host':'127.0.0.1','count':1,'timeout':5})['reachable']
print('Essential image smoke passed')
PY
