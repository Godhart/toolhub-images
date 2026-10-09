#!/bin/sh
# No external network or real container daemon is used; Docker API is mocked for images.
set -eu
[ "$#" -ge 4 ] || { echo 'Usage: smoke-refactored-packs.sh FS_DIR GIT_DIR DOCKER_DIR HDL_DIR [docker|podman]' >&2; exit 2; }
fs=$(CDPATH= cd -- "$1" && pwd)
gitpack=$(CDPATH= cd -- "$2" && pwd)
dockerpack=$(CDPATH= cd -- "$3" && pwd)
hdl=$(CDPATH= cd -- "$4" && pwd)
engine=${5:-docker}
workspace=$(mktemp -d)
trap 'rm -rf "$workspace"' EXIT HUP INT TERM
chmod 777 "$workspace"
for variant in base git docker hdl; do
  case "$variant" in
    base) pack=$fs; action=fs_read; namespace=filesystem_common ;;
    git) pack=$gitpack; action=git_status; namespace=git_common ;;
    docker) pack=$dockerpack; action=docker_images; namespace=docker_common ;;
    hdl) pack=$hdl; action=hdl-order; namespace=hdl_common ;;
  esac
  "$engine" run --rm -i --network none --read-only --user 1000:1000 \
    --tmpfs /tmp:rw,mode=1777 --cap-drop ALL --security-opt no-new-privileges \
    -v "$pack:/tools/pack:ro" -v "$workspace:/workspace" \
    -e TWYLT_GUARDRAILS=1 -e TWYLT_WORKSPACE_ROOT=/workspace -e TWYLT_DISABLE_NETWORK=1 \
    -e PACK_ACTION="$action" -e PACK_NAMESPACE="$namespace" \
    "toolhub-twylt:$variant" python - <<'PY'
import json,os,subprocess,sys,importlib.metadata
from pathlib import Path
assert importlib.metadata.version('twylt')=='1.1.1'
assert importlib.metadata.version('docker')=='7.1.0'
action=os.environ['PACK_ACTION'];ns=os.environ['PACK_NAMESPACE']
assert (Path('/tools/pack/shared')/ns).is_dir()
for tool in sorted(Path('/tools/pack/tools').glob('*/run.py')):
    r=subprocess.run([sys.executable,str(tool),'{"describe":"json_spec"}'],capture_output=True,text=True,timeout=15)
    assert r.returncode==0,r.stderr
    assert json.loads(r.stdout)['name']==tool.parent.name
cwd=Path('/tmp/toolhub-runs/smoke/nested');cwd.mkdir(parents=True)
prefix=''
if action=='fs_read':
    Path('/workspace/a.txt').write_text('updated source pack')
    request={'path':'/a.txt'}
elif action=='git_status':
    subprocess.run(['git','init','/workspace/repo'],check=True,capture_output=True)
    request={'repo':'/repo'}
elif action=='docker_images':
    request={}
    prefix="import docker\nfrom types import SimpleNamespace\ndocker.DockerClient=lambda **kw: SimpleNamespace(api=SimpleNamespace(images=lambda **kw: []),close=lambda: None)\n"
else:
    assert importlib.metadata.version('hdl-order')=='0.8.0'
    Path('/workspace/project').mkdir(exist_ok=True)
    request={'root':'/project'}
(cwd/'input.json').write_text(json.dumps(request))
code=prefix+"from pathlib import Path\nfrom twylt.bootstrap import run_tool_file\nrun_tool_file(Path("+repr('/tools/pack/tools/'+action+'/tool.py')+"))\n"
r=subprocess.run([sys.executable,'-c',code],cwd=cwd,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=20)
assert r.returncode==0,r.stderr
out=json.loads((cwd/'output.json').read_text())
if action=='fs_read':assert out['text']=='updated source pack'
elif action=='hdl-order':assert out['compile_order']==[]
else:assert out['ok']
print(action+' source/guardrails smoke passed')
PY
done
