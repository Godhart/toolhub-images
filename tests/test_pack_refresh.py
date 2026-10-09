"""Pinned source-pack/domain integration; no remote servers or container daemon."""
import json,os,subprocess,sys
from pathlib import Path
import pytest,yaml
from test_domains import fixture,generate,put
from build_domain import Config,env_for

ROOT=Path(__file__).resolve().parents[1]
PACKS=[('filesystem','FILESYSTEM_SOURCE_DIR',13,'fs_read','filesystem_common'),
       ('git','GIT_SOURCE_DIR',10,'git_status','git_common'),
       ('docker','DOCKER_SOURCE_DIR',2,'docker_images','docker_common'),
       ('hdl-order','HDL_SOURCE_DIR',8,'hdl-order','hdl_common')]

@pytest.mark.parametrize('name,key,count,command,namespace',PACKS)
def test_generated_pack_from_updated_source(fixture,tmp_path,name,key,count,command,namespace):
    if not os.environ.get(key):pytest.skip('requires pinned '+name+' checkout')
    source,config,_=fixture
    config['toolsets'][0]['data']['path']=os.environ[key]
    put(source,config);root=Path(generate(source)['root'])
    staged=root/'tools/echo'
    assert (staged/'shared'/namespace).is_dir()
    pack=json.loads((root/'config/worker/echo.toolpack').read_text())
    def all_tools(category):
        yield from category['tools']
        for child in category['children']:yield from all_tools(child)
    tools={t['name']:t for t in all_tools(pack['category'])}
    assert len(tools)==count and command in tools
    workspace=tmp_path/'business';workspace.mkdir()
    runs=tmp_path/'transport';cwd=runs/'request'/'nested';cwd.mkdir(parents=True)
    model=Config.model_validate(config)
    env={**os.environ,**env_for(model,workspace,model.hubs[0])}
    env.update(TWYLT_WORKSPACE_ROOT=str(workspace),TWYLT_ALLOWED_CWD=str(runs),
               TOOLHUB_RUN_ROOT=str(runs),TWYLT_INCIDENT_LOG=str(tmp_path/'incidents.jsonl'))
    prefix=''
    if name=='filesystem':
        (workspace/'a.txt').write_text('updated filesystem')
        request={'path':'/a.txt'}
    elif name=='git':
        subprocess.run(['git','init',str(workspace/'repo')],capture_output=True,check=True)
        request={'repo':'/repo'}
    elif name=='docker':
        request={}
        prefix="import docker\nfrom types import SimpleNamespace\ndocker.DockerClient=lambda **kw: SimpleNamespace(api=SimpleNamespace(images=lambda **kw: []),close=lambda: None)\n"
    else:
        (workspace/'project').mkdir();request={'root':'/project'}
    (cwd/'input.json').write_text(json.dumps(request))
    code=prefix+tools[command]['code'].replace('/tools/echo/',str(staged)+'/')
    result=subprocess.run([sys.executable,'-c',code],cwd=cwd,env=env,
                          stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=20)
    assert result.returncode==0,result.stderr
    output=json.loads((cwd/'output.json').read_text())
    if name=='filesystem':assert output['text']=='updated filesystem'
    elif name=='hdl-order':assert output['compile_order']==[]
    else:assert output['ok']
    assert not (workspace/'output.json').exists()


def test_lock_domain_and_runtime_requirements_agree():
    lock=json.loads((ROOT/'sources.lock.json').read_text())['sources']
    domain=yaml.safe_load((ROOT/'domains/toolhub-domain-example.yaml').read_text())
    for toolset in domain['toolsets']:
        repo='twylt-pack-'+toolset['name'] if toolset['name']!='hdl-order' else 'hdl-order'
        assert toolset['data']['ref']==lock[repo]['commit']
        assert toolset['data']['update']=='always'
    deps=(ROOT/'domains/requirements.txt').read_text()
    assert lock['hdl-order']['commit'] in deps
    assert lock['twylt']['commit'] in deps
    assert 'docker==7.1.0' in deps
    assert 'docker==7.1.0' in (ROOT/'config/python-constraints.txt').read_text()
    dockerfile=(ROOT/'Dockerfile').read_text()
    assert '/sources/twylt-pack-docker/requirements.txt' in dockerfile
    assert 'pip install --no-cache-dir -r /opt/config/python-docker.txt' in dockerfile
    assert 'hdl_order.__version__ == "0.8.0"' in dockerfile
    assert 'pip install --no-cache-dir /opt/hdl-order-source' in dockerfile
    assert dockerfile.index('ENV PIP_CONSTRAINT=')<dockerfile.index('RUN pip install --no-cache-dir /opt/twylt-source')

@pytest.mark.skipif(not os.environ.get('FILESYSTEM_SOURCE_DIR'),reason='requires pinned filesystem checkout')
def test_filesystem_external_requirements_match_source():
    source=Path(os.environ['FILESYSTEM_SOURCE_DIR'])/'requirements.txt'
    expected=[x for x in source.read_text().splitlines() if x and not x.startswith(('#','twylt'))]
    actual=[x for x in (ROOT/'config/python-filesystem.txt').read_text().splitlines() if x and not x.startswith('#')]
    assert actual==expected


def test_full_domain_example_with_updated_local_toolsets(tmp_path):
    paths={entry[0]:os.environ.get(entry[1]) for entry in PACKS}
    paths['essential']=os.environ.get('ESSENTIAL_SOURCE_DIR')
    if not all(paths.values()):pytest.skip('requires all five pinned toolset checkouts')
    config=yaml.safe_load((ROOT/'domains/toolhub-domain-example.yaml').read_text())
    config['domain']['path']=str(tmp_path/'deployment')
    config['domain']['uid']=os.getuid()
    config['domain']['gid']=os.getgid()
    for toolset in config['toolsets']:
        toolset['source_kind']='local'
        toolset['data']={'path':paths[toolset['name']],'update':'always'}
    docker=next(h for h in config['hubs'] if h['name']=='docker')
    docker['docker_socket_gid']=0 # Generation-only smoke; no daemon is accessed.
    source=tmp_path/'example.yaml';put(source,config)
    root=Path(generate(source)['root'])
    counts={'essential':6,'filesystem':13,'git':10,'docker':2,'hdl-order':8}
    total=0
    for name,count in counts.items():
        hub='hdl' if name=='hdl-order' else name
        pack=json.loads((root/'config'/hub/(name+'.toolpack')).read_text())
        def tool_count(category):return len(category['tools'])+sum(tool_count(c) for c in category['children'])
        assert tool_count(pack['category'])==count
        assert (root/'tools'/name/'shared').is_dir()
        total+=count
    assert total==39
    compose=yaml.safe_load((root/'compose.yaml').read_text())
    assert len(compose['services'])==7 # five workers, router, bridge
    mounts=compose['services']['toolhub-example-docker']['volumes']
    assert any(v['target']==str(root/'workspace') and v['read_only'] for v in mounts)
    env=(root/'.env-docker').read_text()
    assert "TOOLHUB_RUN_ROOT='/tmp/toolhub-runs'" in env
    assert "TWYLT_ALLOWED_CWD='/tmp/toolhub-runs'" in env
