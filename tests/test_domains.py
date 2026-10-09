import copy
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import os

import pytest
import yaml
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'domains'))
from build_domain import generate, resolve_paths, Config, dotenv
from toolhub_config.config import load_config
from toolhub_config.database import apply_config

TOOL = '''from pydantic import BaseModel
from twylt import Tool
class Input(BaseModel):
    text: str
class Output(BaseModel):
    text: str
class Echo(Tool[Input, Output]):
    input_model=Input
    output_model=Output
    name="echo"
    version="1.0.0"
    description="echo fixture"
    def biz(self, data): return Output(text=data.text)
TOOL=Echo
if __name__ == "__main__": Echo.run()
'''

@pytest.fixture
def fixture(tmp_path):
    src=tmp_path/'source';(src/'tools/echo').mkdir(parents=True)
    (src/'tools/echo/tool.py').write_text(TOOL)
    config={'domain':{'name':'test','path':'./generated','uid':os.getuid(),'gid':os.getgid(),
                         'admin_pass':"a$#'b\\x",'agent_pass':'s$secret','host':'127.0.0.1:',
                         'workspace':str(tmp_path/'shared')},
            'options':{'remove_unused_tools':True},
            'toolsets':[{'name':'echo','source_kind':'local','data':{'path':str(src),'update':'always'}}],
            'hubs':[{'name':'worker','image':'toolhub-twylt:base','port':1,'packs':[{'toolset':'echo','prefix':'custom/path'}]}]}
    path=tmp_path/'domain.yaml';path.write_text(yaml.safe_dump(config))
    return path,config,src

def put(path,config): path.write_text(yaml.safe_dump(config))

def test_generation_loader_and_paths(fixture):
    path,c,src=fixture
    out=generate(path); root=Path(out['root'])
    compose=yaml.safe_load((root/'compose.yaml').read_text())
    assert compose['name']=='toolhub-test'
    assert all('build' not in s for s in compose['services'].values())
    router=load_config(root/'config/_router_/toolhub.yaml',env={'TOOLHUB_ADMIN_PASSWORD':'admin','TOOLHUB_AGENT_PASSWORD':'agent'})
    assert router['categories']['/worker']['remoteUrl']=='http://toolhub-test-worker:3000'
    worker=load_config(root/'config/worker/toolhub.yaml',env={'TOOLHUB_ADMIN_PASSWORD':'admin','TOOLHUB_AGENT_PASSWORD':'agent'})
    assert '/custom/path/echo' in worker['tools']
    assert '/tools/echo/tools/echo/tool.py' in worker['tools']['/custom/path/echo']['code']
    assert '.toolsets-build-' not in worker['tools']['/custom/path/echo']['code']
    db=root/'data/worker/hub.db'
    with sqlite3.connect(db) as cx:cx.executescript((ROOT/'config-loader/tests/schema.sql').read_text())
    apply_config(db,worker)
    with sqlite3.connect(db) as cx:assert cx.execute('select count(*) from Tool').fetchone()[0]==1
    assert (root/'.env-worker').stat().st_mode & 0o777 == 0o600
    assert "TOOLHUB_AGENT_PASSWORD='s$secret'" in (root/'.env-worker').read_text()
    assert 'ADMIN' not in (root/'.env-_bridge_').read_text()
    assert 'ports' in compose['services']['toolhub-test-worker']

def test_repeat_refresh_once_and_data_preserved(fixture):
    path,c,src=fixture; generate(path)
    root=path.parent/'generated'; sentinel=root/'data/worker/keep';sentinel.write_text('data')
    (src/'tools/echo/tool.py').write_text(TOOL.replace('echo fixture','new description'))
    generate(path)
    assert 'new description' in (root/'config/worker/echo.toolpack').read_text()
    c['toolsets'][0]['data']['update']='once';put(path,c)
    (src/'tools/echo/tool.py').write_text(TOOL.replace('echo fixture','third description'))
    generate(path)
    assert 'new description' in (root/'config/worker/echo.toolpack').read_text()
    assert sentinel.read_text()=='data'

def test_failure_does_not_publish(fixture):
    path,c,src=fixture;generate(path)
    root=path.parent/'generated';before=(root/'config/worker/echo.toolpack').read_bytes()
    (src/'tools/echo/tool.py').write_text('invalid python code')
    with pytest.raises(ValueError,match='cannot probe'):generate(path)
    assert (root/'config/worker/echo.toolpack').read_bytes()==before
    assert (root/'tools/echo/tools/echo/tool.py').read_text()==TOOL

def test_unused_managed_cleanup_not_manual_or_unknown(fixture):
    path,c,src=fixture;generate(path)
    root=path.parent/'generated';unknown=root/'tools/my-stuff';unknown.mkdir();(unknown/'keep').write_text('keep')
    c['toolsets']=[];c['hubs']=[];put(path,c);generate(path)
    assert not (root/'tools/echo').exists()
    assert (unknown/'keep').exists()
    assert not (root/'.env-worker').exists()
    assert (root/'data/worker').exists()

def test_manual_relative_and_shared_workspace(fixture):
    path,c,src=fixture;c['options']['abs_paths']=False
    root=path.parent/'generated';dest=root/'tools/echo/tools/echo';dest.mkdir(parents=True);(dest/'tool.py').write_text(TOOL)
    c['toolsets'][0]={'name':'echo','source_kind':'manual'};c['hubs'][0].pop('port');put(path,c);generate(path)
    comp=yaml.safe_load((root/'compose.yaml').read_text());worker=comp['services']['toolhub-test-worker']
    assert worker['env_file']==['./.env-worker'] and 'ports' not in worker
    c['domain']['name']='second';c['domain']['path']='./second';c['toolsets']=[];c['hubs']=[];put(path,c)
    generate(path)
    assert (root/'tools/echo/tools/echo/tool.py').exists()

def test_exclude_and_legacy_keys(fixture):
    path,c,src=fixture
    (src/'tools/other').mkdir();(src/'tools/other/tool.py').write_text(TOOL.replace('name="echo"','name="other"'))
    c['toolsets'][0]['kind']=c['toolsets'][0].pop('source_kind')
    c['toolsets'][0]['data']['url']=c['toolsets'][0]['data'].pop('path')
    p=c['hubs'][0]['packs'][0];p['ptoolseth']=p.pop('toolset');p['exclude']=['other'];put(path,c);generate(path)
    data=json.loads((path.parent/'generated/config/worker/echo.toolpack').read_text())
    assert [t['name'] for t in data['category']['tools']]==['echo']

@pytest.mark.parametrize('change',[
 lambda c:c['hubs'].append(copy.deepcopy(c['hubs'][0])),
 lambda c:c['hubs'][0]['packs'][0].update(toolset='missing'),
 lambda c:c['hubs'][0].update(port=100),
 lambda c:c['hubs'][0].update(mcps=[{'command':'foo'}]),
 lambda c:c['domain'].update(name='../bad'),
 lambda c:c['domain'].update(env={'TOOLHUB_CONFIG':'bad'}),
 lambda c:c['hubs'][0]['packs'][0].update(toolpak_builder_kwargs={'root':'/etc'}),
])
def test_invalid_before_writes(fixture,change):
    path,c,src=fixture;change(c);put(path,c)
    with pytest.raises((ValidationError,ValueError)):generate(path)
    assert not (path.parent/'generated').exists()

def test_git_fetch_and_revision(fixture):
    path,c,src=fixture
    def git(*a):return subprocess.check_output(['git','-C',str(src),*a],text=True)
    git('init');git('config','user.email','test@localhost');git('config','user.name','Test');git('add','.');git('commit','-m','fixture')
    c['toolsets'][0]['source_kind']='git';c['toolsets'][0]['data']['ref']=git('rev-parse','HEAD').strip();put(path,c)
    generate(path)
    manifest=json.loads((path.parent/'generated/.domain-generated.json').read_text())
    assert manifest['revisions']['echo']==c['toolsets'][0]['data']['ref']
    assert not (path.parent/'generated/tools/echo/.git').exists()

def test_docker_none_and_limits(fixture):
    path,c,src=fixture;c['hubs'][0].update(kind='docker',docker_workspace='none',docker_socket_gid=998,limits={'containers':3})
    put(path,c);generate(path)
    root=path.parent/'generated';comp=yaml.safe_load((root/'compose.yaml').read_text())
    svc=comp['services']['toolhub-test-worker']; assert svc['group_add']==['998']
    assert not any(v['target']=='/workspace' for v in svc['volumes'])
    env=(root/'.env-worker').read_text();assert "TWYLT_DOCKER_MAX_CONTAINERS='3'" in env
    assert "TWYLT_WORKSPACE_ROOT='/tmp/docker-workspace'" in env

def test_duplicate_yaml_and_check(fixture):
    path,c,src=fixture;generate(path,True);assert not (path.parent/'generated').exists()
    path.write_text('domain: {}\ndomain: {}\n')
    with pytest.raises(Exception,match='unique'):generate(path)


def test_cleanup_after_retention(fixture):
    path,c,src=fixture; generate(path)
    c['toolsets']=[];c['hubs']=[];c['options']['remove_unused_tools']=False
    put(path,c);generate(path)
    assert (path.parent/'generated/tools/echo').exists()
    c['options']['remove_unused_tools']=True;put(path,c);generate(path)
    assert not (path.parent/'generated/tools/echo').exists()


def test_symlink_escape_rejected(fixture):
    path,c,src=fixture
    (src/'escape').symlink_to(path.parent,target_is_directory=True)
    with pytest.raises(ValueError,match='symlink escapes'):generate(path)
    assert not (path.parent/'generated/compose.yaml').exists()


@pytest.mark.parametrize('default,override', [(False,None),(False,True),(True,None),(True,False)])
def test_network_inheritance_and_overrides(fixture,default,override):
    path,c,src=fixture
    c['domain']['network']=default
    c['hubs'][0]['network']=override
    put(path,c);generate(path)
    compose=yaml.safe_load((path.parent/'generated/compose.yaml').read_text())
    services=compose['services'];effective=default if override is None else override
    for name,enabled in [('toolhub-test',True),('toolhub-test-mcp',True),('toolhub-test-worker',effective)]:
        assert services[name]['networks']==['domain-internal']+(['domain-egress'] if enabled else [])
        assert 'network_mode' not in services[name]
    assert compose['networks']['domain-internal']=={'internal':True}
    assert 'domain-egress' in compose['networks']
    if default or effective: assert compose['networks']['domain-egress']=={'internal':False}
    assert services['toolhub-test']['ports'][0]['published']==str(c['domain'].get('port_base',3300))


def test_network_defaults_and_private_domain(fixture):
    path,c,src=fixture;generate(path)
    compose=yaml.safe_load((path.parent/'generated/compose.yaml').read_text())
    assert all(s['networks']==['domain-internal','domain-egress'] for s in compose['services'].values())
    c['domain']['network']=False;c['hubs']=[];c['toolsets']=[];c['bridge']={'enabled':False}
    put(path,c);generate(path)
    compose=yaml.safe_load((path.parent/'generated/compose.yaml').read_text())
    assert compose['networks']=={'domain-internal':{'internal':True},'domain-egress':{'internal':False}}
    assert compose['services']['toolhub-test']['networks']==['domain-internal','domain-egress']


@pytest.mark.parametrize('default,override',[(False,None),(False,True),(True,None),(True,False)])
def test_docker_child_network_policy(fixture,default,override):
    path,c,src=fixture
    c['domain']['network']=default
    c['hubs'][0].update(kind='docker',network=override,docker_socket_gid=998,docker_workspace='none')
    put(path,c);generate(path)
    enabled=default if override is None else override
    assert "TWYLT_DOCKER_DISABLE_NETWORK='"+('false' if enabled else 'true')+"'" in (path.parent/'generated/.env-worker').read_text()


@pytest.mark.parametrize('change',[
 lambda c:c['domain'].update(network='false'),
 lambda c:c['domain'].update(network=None),
 lambda c:c['hubs'][0].update(network=1),
 lambda c:c['hubs'][0].update(env={'TWYLT_DOCKER_DISABLE_NETWORK':'false'}),
])
def test_invalid_network_policy_before_writes(fixture,change):
    path,c,src=fixture;change(c);put(path,c)
    with pytest.raises(ValidationError):generate(path)
    assert not (path.parent/'generated').exists()


@pytest.mark.parametrize('prefix', ['', '/', None, 'nested/path'])
def test_pack_target_prefix(fixture,prefix):
    path,c,src=fixture
    c['hubs'][0]['packs'][0]['prefix']=prefix
    put(path,c);generate(path)
    data=yaml.safe_load((path.parent/'generated/config/worker/toolhub.yaml').read_text())
    expected='/echo' if prefix is None else ('/' if prefix in ('','/') else '/nested/path')
    assert data['toolpacks'][0]['path']==expected


def test_multiple_root_packs():
    from models import Hub
    hub=Hub(name='worker',image='test',packs=[{'toolset':'one','prefix':''},{'toolset':'two','prefix':'/'}])
    assert [p.target_path for p in hub.packs]==['/','/']
