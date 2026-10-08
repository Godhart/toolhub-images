#!/usr/bin/env python3
"""Validate YAML, stage toolsets and packs, then publish one domain deployment.

Only generated files/toolsets are replaced. Database files are never modified here.
ToolHub applies reset/merge when its service is started. Tool probing executes trusted
source code using toolpack-builder. No image build or container startup occurs here.
"""
from __future__ import annotations
import argparse
import fcntl
import fnmatch
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from uuid import uuid4
from contextlib import contextmanager

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from pydantic import ValidationError
from models import Config, Limits
from toolhub_config.config import load_config, read_document
from toolpack_builder.builder import BuildConfig, scan, build_from_report

HERE = Path(__file__).resolve().parent
RUNNER = {'name':'TWYLT Python', 'type':'python_local', 'config':{
    'codeFileName':'tool.py', 'depFileName':'requirements.txt',
    'installCmd':'', 'runCmd':'python tool.py < /dev/null'}}


def resolve_paths(config, source):
    domain = config.domain
    root = Path(domain.path).expanduser()
    root = (source.parent / root).resolve() if not root.is_absolute() else root.resolve()
    def child(value):
        p = Path(value).expanduser()
        if p.is_absolute(): return p.resolve()
        return ((source.parent if value.startswith('.') else root) / p).resolve()
    tools, workspace = child(domain.tools), child(domain.workspace)
    if root == Path('/') or tools == Path('/') or workspace == Path('/'):
        raise ValueError('filesystem root cannot be a domain/tools/workspace directory')
    critical = [root/'data', root/'config']
    if tools == root or workspace == root or root.is_relative_to(tools) or root.is_relative_to(workspace):
        raise ValueError('tools/workspace cannot contain domain root')
    for a, b in [(tools,workspace)] + [(x,y) for x in (tools,workspace) for y in critical]:
        if a.is_relative_to(b) or b.is_relative_to(a):
            raise ValueError('tools, workspace, config and data must not overlap')
    return root, tools, workspace


def text_value(value):
    return str(value).lower() if isinstance(value,bool) else str(value)


def dotenv(value):
    # Single quoted Compose env_file values do not expand $, # or spaces.
    return "'" + text_value(value).replace("'", "\\'") + "'"


def compose_literals(value):
    if isinstance(value,str): return value.replace('$','$$')
    if isinstance(value,list): return [compose_literals(x) for x in value]
    if isinstance(value,dict): return {k:compose_literals(v) for k,v in value.items()}
    return value


def write(path, text, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text,encoding='utf-8')
    path.chmod(mode)


def yaml_text(value):
    return yaml.safe_dump(value,allow_unicode=True,sort_keys=False)


def effective_limits(config, hub=None):
    fields = config.domain.limits.model_dump()
    if hub:
        fields.update(hub.limits.model_dump(exclude_none=True))
    return Limits(**fields)


def network_enabled(config, hub=None):
    return config.domain.network if hub is None or hub.network is None else hub.network


def env_for(config, workspace, hub=None):
    domain = config.domain
    result = {k:text_value(v) for k,v in domain.env.items()}
    result.update({k:text_value(v) for k,v in (hub.env if hub else domain.env_router).items()})
    result.update(WORKSPACE_HOST_PATH=str(workspace), TOOLHUB_ADMIN_PASSWORD=domain.admin_pass,
                  TOOLHUB_AGENT_PASSWORD=domain.agent_pass, TOOLHUB_SEED_LANG=domain.seed_lang,
                  TOOLHUB_CONFIG='/config/toolhub.yaml', DATABASE_URL='file:/data/hub.db', PORT='3000')
    result.setdefault('TWYLT_GUARDRAILS','1')
    result.setdefault('TOOLHUB_RUN_ROOT',result.get('TWYLT_ALLOWED_CWD','/tmp/toolhub-runs'))
    result.setdefault('TWYLT_ALLOWED_CWD',result['TOOLHUB_RUN_ROOT'])
    result['TWYLT_DISABLE_NETWORK'] = 'false' if network_enabled(config,hub) else 'true'
    if hub:
        if hub.kind == 'docker':
            result['TWYLT_WORKSPACE_ROOT'] = str(workspace) if hub.docker_workspace == 'host-readonly' else '/tmp/docker-workspace'
            result['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
            result['TWYLT_DOCKER_MAX_CONTAINERS'] = str(effective_limits(config,hub).containers)
            result['TWYLT_DOCKER_DISABLE_NETWORK'] = 'false' if network_enabled(config,hub) else 'true'
        else:
            result['TWYLT_WORKSPACE_ROOT'] = '/workspace'
        result.setdefault('TWYLT_INCIDENT_LOG','/data/incidents.jsonl')
    return result


def hub_config(config):
    return {'version':1,'mode':'reset' if config.options.reset_settings else 'merge',
            'settings':{'adminPasswordEnv':'TOOLHUB_ADMIN_PASSWORD','agentSecretEnv':'TOOLHUB_AGENT_PASSWORD',
                        'rootPrompt':'Use listTools("/") to discover categories. Use absolute tool paths.\n{{AvailableResources}}',
                        'rootAppendPrompt':'Use listTools("/folder") to navigate.', 'maxLogRetention':1000},
            'runners':[], 'toolpacks':[], 'remotes':[], 'mcp':[]}


def make_compose(config, root, tools, workspace):
    domain = config.domain
    def path(p):
        return str(p) if config.options.abs_paths else './' + os.path.relpath(p,root)
    def mount(src, dest, readonly=False):
        return {'type':'bind','source':path(src),'target':dest,'read_only':readonly,
                'bind':{'create_host_path':False}}
    def service(hub=None):
        name = hub.name if hub else '_router_'
        limits = effective_limits(config,hub)
        data = {'image':hub.image if hub else 'toolhub-twylt:base', 'init':False,
                'user':f'{domain.uid}:{domain.gid}', 'env_file':[path(root/f'.env-{name}')],
                'volumes':[mount(root/'data'/name,'/data'),mount(root/'config'/name,'/config',True)],
                'read_only':True,'tmpfs':[f'/tmp:rw,nosuid,nodev,size={limits.tmp},mode=1777'],
                'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],
                'pids_limit':limits.pids,'mem_limit':limits.mem,'cpus':limits.cpu,
                'healthcheck':{'test':['CMD','python','-c','from pathlib import Path; import socket; assert Path("/tmp/toolhub-config.ready").exists(); socket.create_connection(("127.0.0.1",3000),2).close()'],
                               'interval':'5s','timeout':'3s','start_period':'90s','retries':12}}
        data['networks'] = ['domain-internal']
        if network_enabled(config,hub):
            data['networks'].append('domain-egress')
        offset = hub.port if hub else 0
        if offset is not None:
            data['ports']=[{'target':3000,'published':str(domain.port_base+offset),'host_ip':domain.host,'protocol':'tcp'}]
        if hub:
            for pack in hub.packs:
                data['volumes'].append(mount(tools/pack.toolset, '/tools/'+pack.toolset,True))
            if hub.kind == 'general':
                data['volumes'].append(mount(workspace,'/workspace'))
            else:
                socket = Path(hub.docker_socket).expanduser()
                if not socket.is_absolute():
                    raise ValueError('docker_socket must be an absolute host socket path')
                data['volumes'].append(mount(socket,'/var/run/docker.sock'))
                gid = hub.docker_socket_gid
                if gid is None and socket.exists(): gid = socket.stat().st_gid
                if gid is not None: data['group_add']=[str(gid)]
                elif domain.uid != 0:
                    raise ValueError('set docker_socket_gid or build on the daemon host with its socket present')
                if hub.docker_workspace == 'host-readonly':
                    if any(workspace.is_relative_to(p) for p in map(Path,['/opt','/usr','/bin','/sbin','/etc','/proc','/sys','/dev','/data','/tools','/config'])):
                        raise ValueError('Docker workspace host path conflicts with container runtime paths')
                    data['volumes'].append(mount(workspace,str(workspace),True))
        return data
    router = 'toolhub-'+domain.name
    services = {router:service()}
    for hub in config.hubs:
        services[router+'-'+hub.name] = service(hub)
    if config.hubs:
        services[router]['depends_on']={router+'-'+h.name:{'condition':'service_healthy'} for h in config.hubs}
    if config.bridge.enabled:
        services[router+'-mcp']={'image':config.bridge.image,'user':f'{domain.uid}:{domain.gid}',
            'env_file':[path(root/'.env-_bridge_')], 'read_only':True,
            'tmpfs':['/tmp:rw,nosuid,nodev,size=64m,mode=1777'],
            'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],
            'pids_limit':128,'mem_limit':'512m','cpus':1.0,
            'ports':[{'target':8000,'published':str(domain.port_base+config.bridge.port),'host_ip':domain.host,'protocol':'tcp'}],
            'depends_on':{router:{'condition':'service_healthy'}}}
    if config.bridge.enabled:
        services[router+'-mcp']['networks'] = ['domain-internal']
        if network_enabled(config):
            services[router+'-mcp']['networks'].append('domain-egress')
    networks = {'domain-internal': {'internal': True}}
    if any('domain-egress' in service['networks'] for service in services.values()):
        networks['domain-egress'] = {'internal': False}
    return {'name':'toolhub-'+domain.name, 'services':services, 'networks':networks}


def populate(toolset, root, tools, stage, source):
    current = tools/toolset.name
    if current.is_symlink(): raise ValueError('toolset root cannot be a symlink')
    if toolset.source_kind == 'manual':
        if not current.is_dir():
            raise ValueError(f'populate manual toolset before building: {current}')
        return current, False, None
    if current.is_dir() and toolset.data.update == 'once': return current,False,None
    target = stage/toolset.name
    if toolset.source_kind == 'local':
        origin = Path(toolset.data.path).expanduser()
        if not origin.is_absolute(): origin = source.parent/origin
        origin = origin.resolve()
        if not origin.is_dir() or tools.is_relative_to(origin) or root.is_relative_to(origin):
            raise ValueError('local source must exist and cannot contain domain/tools output')
        shutil.copytree(origin,target,symlinks=True,ignore=shutil.ignore_patterns('.git','__pycache__'))
        revision = None
    else:
        target.mkdir()
        def git(*args):
            p = subprocess.run(['git','-C',str(target),*args],capture_output=True,text=True,timeout=180)
            if p.returncode: raise ValueError(f'Git operation failed for toolset {toolset.name}; check URL/ref/access')
            return p.stdout.strip()
        git('init','-q'); git('remote','add','origin',toolset.data.path)
        git('fetch','--depth=1','origin',toolset.data.ref); git('checkout','--detach','FETCH_HEAD')
        revision = git('rev-parse','HEAD')
        shutil.rmtree(target/'.git')
    return target,True,revision


def build_pack(pack, origin):
    for path in origin.rglob("*"):
        if path.is_symlink() and not path.resolve().is_relative_to(origin.resolve()):
            raise ValueError("toolset symlink escapes its root")
    kwargs = dict(pack.toolpak_builder_kwargs)
    kwargs.setdefault('glob','**/tool.py')
    if 'excludes' in kwargs: kwargs['excludes'] = tuple(kwargs['excludes'])
    config = BuildConfig(root=origin,category_name=pack.toolset,runner_name=RUNNER['name'],**kwargs)
    report = scan(config)
    if report.failed:
        failures = ', '.join(str(i.path.relative_to(origin)) for i in report.failed)
        raise ValueError(f'cannot probe {pack.toolset}: {failures}; install tool dependencies in builder Python')
    report.items = [i for i in report.items if not any(fnmatch.fnmatchcase(i.spec.declared_name or '',p) or
                    fnmatch.fnmatchcase(i.path.relative_to(origin).as_posix(),p) for p in pack.exclude)]
    if not report.valid: raise ValueError(f'no tools selected for {pack.toolset}')
    paths = {}
    for item in report.valid:
        if not item.path.resolve().is_relative_to(origin.resolve()):
            raise ValueError('tool path escapes its toolset')
        paths[item.spec.declared_name] = '/tools/'+pack.toolset+'/'+item.path.relative_to(origin).as_posix()
    payload = build_from_report(config,report).payload
    def rewrite(category):
        for tool in category['tools']:
            path = paths[tool['name']]
            tool['code'] = 'from pathlib import Path\nfrom twylt.bootstrap import run_tool_file\nrun_tool_file(Path('+repr(path)+'))\n'
        for child in category['children']: rewrite(child)
    rewrite(payload['category'])
    return payload


@contextmanager
def root_lock(root):
    with (root/'.domain.lock').open('a') as file:
        try: fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('another domain generator owns this root') from None
        yield


def publish(actions, deletes):
    """Same-filesystem renames, with rollback. Caller supplies staged paths beside targets."""
    done = []
    try:
        for staged, target in actions + [(None,p) for p in deletes]:
            if target.is_symlink(): raise ValueError('refusing to replace a symlink')
            backup = None
            if target.exists():
                backup = target.with_name(target.name+'.old-'+uuid4().hex)
                target.rename(backup)
            done.append((target,backup))
            if staged is not None: staged.rename(target)
    except BaseException:
        for target, backup in reversed(done):
            if target.is_dir(): shutil.rmtree(target)
            elif target.exists(): target.unlink()
            if backup: backup.rename(target)
        raise
    for _,backup in done:
        if backup and backup.is_dir(): shutil.rmtree(backup)
        elif backup: backup.unlink()


def generate(source, check=False):
    source = Path(source).resolve()
    config = Config.model_validate(read_document(source))
    root, tools, workspace = resolve_paths(config,source)
    for managed in (root/'data', root/'config'):
        if managed.is_symlink(): raise ValueError('domain data/config parent cannot be a symlink')
    compose = make_compose(config,root,tools,workspace)  # errors before touching output
    if check:
        return {'valid':True,'root':str(root),'hubs':len(config.hubs),'bridge':config.bridge.enabled}
    root.mkdir(parents=True,exist_ok=True)
    tools.mkdir(parents=True,exist_ok=True)
    workspace_created = not workspace.exists()
    workspace.mkdir(parents=True,exist_ok=True)
    if workspace_created and os.geteuid() == 0:
        os.chown(workspace,config.domain.uid,config.domain.gid)
    templates = Environment(loader=FileSystemLoader(HERE),undefined=StrictUndefined,autoescape=False,keep_trailing_newline=True)
    templates.filters.update(yaml=yaml_text,dotenv=dotenv)
    with root_lock(root), tempfile.TemporaryDirectory(prefix='.domain-build-',dir=root) as tmp, tempfile.TemporaryDirectory(prefix='.toolsets-build-',dir=tools) as tooltmp:
        stage = Path(tmp); toolstage = Path(tooltmp)
        manifest_path = root/'.domain-generated.json'
        previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        if previous and previous.get('domain') != config.domain.name:
            raise ValueError('domain root already belongs to another domain')
        actions = []; origins = {}; revisions = {}; kinds = {}
        for toolset in config.toolsets:
            origin, updated, rev = populate(toolset,root,tools,toolstage,source)
            origins[toolset.name] = origin
            revisions[toolset.name] = rev or previous.get('revisions',{}).get(toolset.name)
            kinds[toolset.name] = toolset.source_kind
            if updated: actions.append((origin,tools/toolset.name))
        configs = stage/'config'; configs.mkdir()
        names = ['_router_']+[h.name for h in config.hubs]
        for hub in config.hubs:
            value = hub_config(config); value['runners']=[RUNNER]
            for pack in hub.packs:
                payload = build_pack(pack,origins[pack.toolset])
                write(configs/hub.name/(pack.toolset+'.toolpack'),json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
                value['toolpacks'].append({'file':pack.toolset+'.toolpack','path':'/'+(pack.prefix or pack.toolset).strip('/'),'runner':RUNNER['name']})
            write(configs/hub.name/'toolhub.yaml',yaml_text(value))
            load_config(configs/hub.name/'toolhub.yaml',env=env_for(config,workspace,hub))
        router = hub_config(config)
        router['remotes']=[{'path':'/'+h.name,'name':h.name,'url':'http://toolhub-'+config.domain.name+'-'+h.name+':3000','tokenEnv':'TOOLHUB_AGENT_PASSWORD'} for h in config.hubs]
        write(configs/'_router_'/'toolhub.yaml',yaml_text(router))
        load_config(configs/'_router_'/'toolhub.yaml',env=env_for(config,workspace))
        actions.append((configs,root/'config'))
        for name, hub in [('_router_',None)]+[(h.name,h) for h in config.hubs]:
            write(stage/f'.env-{name}',templates.get_template('env.template').render(env=env_for(config,workspace,hub)),0o600)
            actions.append((stage/f'.env-{name}',root/f'.env-{name}'))
        generated_envs = ['.env-'+n for n in names]
        if config.bridge.enabled:
            env = {'TOOLHUB_URL':'http://toolhub-'+config.domain.name+':3000','TOOLHUB_AGENT_PASSWORD':config.domain.agent_pass,
                   'TOOLHUB_MCP_TRANSPORT':'streamable-http','TOOLHUB_MCP_HOST':'0.0.0.0','TOOLHUB_MCP_PORT':'8000'}
            write(stage/'.env-_bridge_',templates.get_template('env.template').render(env=env),0o600)
            actions.append((stage/'.env-_bridge_',root/'.env-_bridge_')); generated_envs.append('.env-_bridge_')
        rendered = templates.get_template('compose.template.yaml').render(compose=compose_literals(compose))
        if yaml.safe_load(rendered) != compose_literals(compose): raise ValueError('Compose template changed structure')
        write(stage/'compose.yaml',rendered)
        actions.append((stage/'compose.yaml',root/'compose.yaml'))
        retained = dict(previous.get('toolsets', {})) if previous.get('tools_root') == str(tools) else {}
        if config.options.remove_unused_tools:
            retained = {name: kind for name, kind in retained.items() if kind == 'manual'}
        retained.update(kinds)
        manifest = {'version':1,'domain':config.domain.name,'tools_root':str(tools),'toolsets':retained,'revisions':revisions,'env_files':generated_envs}
        write(stage/'.domain-generated.json',json.dumps(manifest,indent=2)+'\n')
        deletes = []
        for name in previous.get('env_files',[]):
            if Path(name).name != name or not name.startswith('.env-'): raise ValueError('invalid prior manifest')
            if name not in generated_envs: deletes.append(root/name)
        if config.options.remove_unused_tools and previous.get('tools_root') == str(tools):
            for name, kind in previous.get('toolsets',{}).items():
                if Path(name).name != name or name in ('.','..'): raise ValueError('invalid prior manifest')
                if name not in kinds and kind != 'manual': deletes.append(tools/name)
        actions.append((stage/'.domain-generated.json',manifest_path))
        # Databases survive all rebuilds; only create missing mount directories.
        for name in names:
            folder = root/'data'/name
            if folder.is_symlink(): raise ValueError('data directory cannot be symlink')
            if not folder.exists():
                folder.mkdir(parents=True)
                if os.geteuid() == 0: os.chown(folder,config.domain.uid,config.domain.gid)
        publish(actions,deletes)
    return {'root':str(root),'compose':str(root/'compose.yaml'),'workers':len(config.hubs),'toolsets':len(config.toolsets)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config',type=Path)
    parser.add_argument('--check',action='store_true',help='validate source, references, paths and ports without writing/probing')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(generate(args.config,args.check),ensure_ascii=False))
        return 0
    except ValidationError as exc:
        # Never print Pydantic input values; these may contain credentials.
        errors = [{'path':'.'.join(map(str,e['loc'])),'type':e['type']} for e in exc.errors(include_input=False)]
        print('Invalid domain: '+json.dumps(errors),file=sys.stderr)
        return 2
    except Exception as exc:
        print(f'domain build failed: {exc}',file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
