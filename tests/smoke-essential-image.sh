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
  -e TWYLT_WORKSPACE_ROOT=/workspace -e TWYLT_GUARDRAILS=1 -e TWYLT_DISABLE_NETWORK=0 \
  toolhub-twylt:essential python - <<'PY'
import json, subprocess, sys, importlib.util, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import twylt
assert twylt.__version__ == "1.1.1"
assert importlib.util.find_spec("twylt_pack_essential") is None
from pathlib import Path
assert Path("/tools/essential/shared/essential_common/http.py").is_file()

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
# Real file transport in a nested cwd outside /workspace.
cwd = Path('/tmp/toolhub-runs/smoke/nested'); cwd.mkdir(parents=True)
(cwd/'input.json').write_text('{"text":"nested cwd"}')
result = subprocess.run([sys.executable,'/tools/essential/tools/echo/run.py'],
                        cwd=cwd,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=15)
assert result.returncode == 0,result.stderr
assert json.loads((cwd/'output.json').read_text()) == {'text':'nested cwd'}
# Real HTTP from source shared/ in a mounted read-only pack; no external network.
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'shared source smoke')
server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    (cwd/'input.json').write_text(json.dumps({'url':f'http://127.0.0.1:{server.server_port}/'}))
    result = subprocess.run([sys.executable,'/tools/essential/tools/curl/run.py'],
                            cwd=cwd,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=15)
    assert result.returncode == 0,result.stderr
    assert json.loads((cwd/'output.json').read_text())['text'] == 'shared source smoke'
finally:
    server.shutdown(); server.server_close()
print('Essential image smoke passed')
PY
