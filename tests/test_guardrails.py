"""Domain policy and real TWYLT transport integration."""
import json,os,subprocess,sys,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import pytest
from test_domains import fixture,generate,put
from build_domain import env_for,Config

ROOT=Path(__file__).resolve().parents[1]

@pytest.mark.parametrize('network',[True,False])
def test_generated_policy(fixture,network):
    source,config,_=fixture
    config['domain']['network']=network
    put(source,config);root=Path(generate(source)['root'])
    for name in ['worker','_router_']:
        env=(root/f'.env-{name}').read_text()
        assert "TWYLT_GUARDRAILS='1'" in env
        assert "TWYLT_ALLOWED_CWD='/tmp/toolhub-runs'" in env
        assert "TOOLHUB_RUN_ROOT='/tmp/toolhub-runs'" in env
        assert "TWYLT_DISABLE_NETWORK='"+('false' if network else 'true')+"'" in env

@pytest.mark.parametrize('key',['TWYLT_ALLOWED_CWD','TOOLHUB_RUN_ROOT'])
def test_custom_cwd_root_and_actual_launcher(fixture,tmp_path,key):
    source,config,tools=fixture
    runs=tmp_path/'transport';runs.mkdir()
    config['hubs'][0]['env']={key:str(runs)}
    put(source,config);root=Path(generate(source)['root'])
    model=Config.model_validate(config)
    ws=tmp_path/'workspace';ws.mkdir()
    env=env_for(model,ws,model.hubs[0])
    # Native equivalent of the container workspace bind mount.
    env['TWYLT_WORKSPACE_ROOT']=str(ws)
    env['TWYLT_INCIDENT_LOG']=str(tmp_path/'incidents.jsonl')
    cwd=runs/'request'/'python';cwd.mkdir(parents=True)
    (cwd/'input.json').write_text('{"text":"nested"}')
    pack=json.loads((root/'config/worker/echo.toolpack').read_text())
    def all_tools(category):
        yield from category['tools']
        for child in category['children']: yield from all_tools(child)
    tool=next(all_tools(pack['category']))
    code=tool['code'].replace('/tools/echo/',str(root/'tools/echo')+'/')
    result=subprocess.run([sys.executable,'-c',code],env={**os.environ,**env},cwd=cwd,
                          stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=15)
    assert result.returncode==0,result.stderr
    assert json.loads((cwd/'output.json').read_text())=={'text':'nested'}
    assert not (ws/'output.json').exists()


def test_dependency_lock_and_install_order():
    lock=json.loads((ROOT/'sources.lock.json').read_text())
    assert lock['sources']['twylt']['commit']=='bffdf247865b8e34f6c61f72327d869d8b4bd708'
    assert lock['sources']['twylt-pack-essential']['commit']=='938da46801b931f1ee0a2c67fbeedcd82313a92c'
    docker=(ROOT/'Dockerfile').read_text()
    assert docker.index('pip install --no-cache-dir -r /opt/config/python-base.txt') < docker.index('pip install --no-cache-dir /opt/twylt-source')
    assert 'pip install --no-cache-dir -r /opt/config/python-essential.txt' in docker
    assert 'pip install --no-cache-dir /opt/essential-source' not in docker
    assert 'twylt-pack-essential' not in (ROOT/'config/python-constraints.txt').read_text()
    assert 'twylt-pack-essential @' not in (ROOT/'domains/requirements.txt').read_text()
    assert 'twylt==1.1.1' in (ROOT/'config/python-constraints.txt').read_text()
    assert 'PIP_CONSTRAINT=/opt/config/python-constraints.txt' in docker
    assert '/opt/hdl-order-source[twylt]' not in docker
    assert 'hdl-order[twylt]' not in (ROOT/'domains/requirements.txt').read_text()
    assert not (ROOT/'vendor').exists()


@pytest.mark.skipif(not os.environ.get('ESSENTIAL_SOURCE_DIR'),reason='requires pinned upstream essential checkout')
def test_real_essential_discovery(fixture):
    source,config,_=fixture
    config['toolsets'][0]['data']['path']=os.environ['ESSENTIAL_SOURCE_DIR']
    put(source,config);root=Path(generate(source)['root'])
    pack=json.loads((root/'config/worker/echo.toolpack').read_text())
    def names(category):
        result={t['name'] for t in category['tools']}
        for child in category['children']:result.update(names(child))
        return result
    assert names(pack['category'])=={'echo','sleep','wget','curl','ping','web_search'}


@pytest.mark.skipif(not os.environ.get('ESSENTIAL_SOURCE_DIR'),reason='requires pinned upstream essential checkout')
def test_source_shared_http_through_generated_domain(fixture,tmp_path):
    source,config,_=fixture
    config['domain']['network']=True
    config['toolsets'][0]['data']['path']=os.environ['ESSENTIAL_SOURCE_DIR']
    put(source,config)
    root=Path(generate(source)['root'])
    staged=root/'tools/echo'
    assert (staged/'shared/essential_common/http.py').is_file()
    compose=(root/'compose.yaml').read_text()
    assert '/tools/echo' in compose
    pack=json.loads((root/'config/worker/echo.toolpack').read_text())
    def all_tools(category):
        yield from category['tools']
        for child in category['children']:yield from all_tools(child)
    tools={t['name']:t for t in all_tools(pack['category'])}
    code=tools['curl']['code'].replace('/tools/echo/',str(staged)+'/')
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            self.send_response(200);self.end_headers();self.wfile.write(b'shared source runtime')
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        runs=tmp_path/'runs';cwd=runs/'request'/'nested';cwd.mkdir(parents=True)
        ws=tmp_path/'business';ws.mkdir()
        env={**os.environ,'TWYLT_GUARDRAILS':'1','TWYLT_DISABLE_NETWORK':'0',
             'TWYLT_WORKSPACE_ROOT':str(ws),'TWYLT_ALLOWED_CWD':str(runs)}
        # Fail immediately if the launcher tries the obsolete installed pack.
        blocker=tmp_path/'blocker';blocker.mkdir()
        (blocker/'sitecustomize.py').write_text(
            "import sys\nclass BlockLegacy:\n"
            " def find_spec(self,fullname,path=None,target=None):\n"
            "  if fullname.split('.')[0] == 'twylt_pack_essential':\n"
            "   raise ImportError('Installed essential package is forbidden')\n"
            "sys.meta_path.insert(0,BlockLegacy())\n")
        env['PYTHONPATH']=str(blocker)
        (cwd/'input.json').write_text(json.dumps({'url':f'http://127.0.0.1:{server.server_port}/'}))
        r=subprocess.run([sys.executable,'-c',code],cwd=cwd,env=env,
                         stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=15)
        assert r.returncode==0,r.stderr
        assert json.loads((cwd/'output.json').read_text())['text']=='shared source runtime'
        (cwd/'output.json').unlink()
        env['TWYLT_DISABLE_NETWORK']='1'
        r=subprocess.run([sys.executable,'-c',code],cwd=cwd,env=env,
                         stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=15)
        assert r.returncode==6,r.stderr
        assert json.loads(r.stderr.splitlines()[-1])['error']['code']=='network_disabled'
        assert not (cwd/'output.json').exists()
    finally:
        server.shutdown();server.server_close()
