"""Domain policy and real TWYLT transport integration."""
import json,os,subprocess,sys
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
    assert lock['sources']['twylt']['commit']=='4de2805d73df81b4eadb405e0bca7fe8e5c0dbc5'
    assert lock['sources']['twylt-pack-essential']['commit']=='488e1a78f0400161884cd8034409b9d733880394'
    docker=(ROOT/'Dockerfile').read_text()
    assert docker.index('pip install --no-cache-dir -r /opt/config/python-base.txt') < docker.index('pip install --no-cache-dir /opt/twylt-source')
    assert 'pip install --no-cache-dir /opt/essential-source' in docker
    assert 'PIP_CONSTRAINT=/opt/config/python-constraints.txt' in docker
    assert '/opt/hdl-order-source[twylt]' not in docker
    assert 'hdl-order[twylt]' not in (ROOT/'domains/requirements.txt').read_text()
    assert not (ROOT/'vendor').exists()


@pytest.mark.skipif(not os.environ.get('ESSENTIAL_SOURCE_DIR'),reason='requires pinned upstream essential checkout')
def test_real_essential_discovery(fixture,monkeypatch):
    source,config,_=fixture
    config['toolsets'][0]['data']['path']=os.environ['ESSENTIAL_SOURCE_DIR']
    put(source,config);root=Path(generate(source)['root'])
    pack=json.loads((root/'config/worker/echo.toolpack').read_text())
    def names(category):
        result={t['name'] for t in category['tools']}
        for child in category['children']:result.update(names(child))
        return result
    assert names(pack['category'])=={'echo','sleep','wget','curl','ping','web_search'}
