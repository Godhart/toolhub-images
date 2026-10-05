"""Read and fully validate input before opening a writable database."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import yaml
from jsonschema import Draft202012Validator


class ConfigError(Exception):
    pass


class UniqueLoader(yaml.SafeLoader):
    pass


def unique_map(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str) or key in result:
            raise ConfigError('Mapping keys must be unique strings')
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_map)


def read_document(path):
    try:
        # JSON is also accepted by the strict YAML parser; duplicate keys rejected.
        value = yaml.load(Path(path).read_text(encoding='utf-8'), Loader=UniqueLoader)
        json.dumps(value, allow_nan=False)  # Reject YAML dates, cycles, infinities, etc.
        return value
    except ConfigError:
        raise
    except (OSError, ValueError, TypeError, yaml.YAMLError, RecursionError):
        raise ConfigError(f'Cannot read JSON/YAML document: {path}') from None


def validate(value, schema_name):
    schema = json.loads(Path(__file__).with_name(schema_name).read_text())
    errors = sorted(Draft202012Validator(schema).iter_errors(value), key=lambda e: str(list(e.path)))
    if errors:
        e = errors[0]
        where = '/'.join(map(str, e.absolute_path)) or '<root>'
        # Never echo input values: a validation error may contain credentials.
        raise ConfigError(f'{schema_name}: invalid {where} ({e.validator})')


def env_value(name, env):
    value = env.get(name)
    if not value:
        raise ConfigError(f'Required environment variable is empty or missing: {name}')
    return value


def slug(value):
    # Explicit slug required for names which cannot be represented unambiguously.
    result = re.sub('[^a-z0-9]+', '-', value.lower()).strip('-')
    if not result:
        raise ConfigError('Use an explicit ASCII slug for a non-ASCII tool/category name')
    return result


def url_check(value):
    try:
        p = urlsplit(value)
        valid = (p.scheme in ('http', 'https') and p.hostname and not p.username
                 and not p.password and not p.query and not p.fragment)
        p.port
    except ValueError:
        valid = False
    if not valid:
        raise ConfigError('Remote URL must be http(s), without credentials, query or fragment')


def load_config(path, env=None, mode=None):
    env = os.environ if env is None else env
    path = Path(path).resolve()
    config = read_document(path)
    validate(config, 'config.schema.json')
    settings = dict(config['settings'])
    settings['adminPassword'] = env_value(settings.pop('adminPasswordEnv'), env)
    settings['agentSecret'] = env_value(settings.pop('agentSecretEnv'), env)
    if 'rootPromptFile' in settings:
        try:
            settings['rootPrompt'] = (path.parent / settings.pop('rootPromptFile')).read_text('utf-8')
        except OSError:
            raise ConfigError('Cannot read rootPromptFile') from None
    plan = dict(mode=mode or config.get('mode', 'merge'), settings=settings,
                runners=config.get('runners', []), categories={}, tools={}, sync=[])
    names = [r['name'] for r in plan['runners']]
    if len(names) != len(set(names)):
        raise ConfigError('Duplicate runner name')

    def category(full_path, data, explicit=True):
        previous = plan['categories'].get(full_path)
        if previous and explicit and previous['_explicit']:
            raise ConfigError(f'Duplicate category path: {full_path}')
        if previous and not explicit:
            return
        plan['categories'][full_path] = dict(data, _explicit=explicit)
        parent = full_path.rpartition('/')[0]
        if parent:
            category(parent, dict(name=parent.rsplit('/', 1)[1], type='LOCAL'), False)

    def tool(target, data, runner):
        if data.get('isMcpProxy'):
            raise ConfigError('Promoted MCP proxy tools are not portable; configure the MCP server instead')
        tool_slug = data.get('slug') or slug(data['name'])
        key = target + '/' + tool_slug
        if key in plan['tools']:
            raise ConfigError(f'Duplicate tool path: {key}')
        plan['tools'][key] = dict(data, slug=tool_slug, _category=target, _runner=runner)

    def pack_node(node, full_path, runner):
        kind = node.get('type', 'LOCAL')
        data = {k: v for k, v in node.items() if k not in ('tools', 'children', 'slug')}
        data['type'] = kind
        if kind != 'LOCAL' and (node.get('tools') or node.get('children')):
            raise ConfigError('Gateway categories cannot contain local tools/children')
        if kind == 'REMOTE':
            url_check(node.get('remoteUrl') or '')
        if kind == 'MCP' and not node.get('mcpCommand'):
            raise ConfigError('MCP category requires mcpCommand')
        category(full_path, data)
        if kind == 'MCP' and node.get('isActive', True):
            plan['sync'].append(full_path)
        for item in node.get('tools', []):
            tool(full_path, item, runner)
        for child in node.get('children', []):
            pack_node(child, full_path + '/' + (child.get('slug') or slug(child['name'])), runner)

    for item in config.get('toolpacks', []):
        payload = read_document(path.parent / item['file'])
        validate(payload, 'toolpack.schema.json')
        if payload['kind'] == 'TOOLHUB_TOOL':
            if 'path' not in item:
                raise ConfigError('A TOOLHUB_TOOL needs toolpacks[].path (target category)')
            category(item['path'], dict(name=item['path'].rsplit('/', 1)[1], type='LOCAL'), False)
            tool(item['path'], payload['tool'], item.get('runner'))
        else:
            node = payload['category']
            full_path = item.get('path') or '/' + (node.get('slug') or slug(node['name']))
            pack_node(node, full_path, item.get('runner'))

    for item in config.get('remotes', []):
        url_check(item['url'])
        category(item['path'], dict(name=item.get('name', item['path'].rsplit('/', 1)[1]),
                 type='REMOTE', isActive=item.get('isActive', True), appendPrompt=item.get('appendPrompt'),
                 remoteUrl=item['url'].rstrip('/'), remoteToken=env_value(item['tokenEnv'], env)))
    for item in config.get('mcp', []):
        mcp_env = dict(item.get('env', {}))
        if set(mcp_env) & set(item.get('envFrom', {})):
            raise ConfigError('Duplicate MCP variable in env and envFrom')
        mcp_env.update({key: env_value(value, env) for key, value in item.get('envFrom', {}).items()})
        category(item['path'], dict(name=item.get('name', item['path'].rsplit('/', 1)[1]),
                 type='MCP', isActive=item.get('isActive', True), appendPrompt=item.get('appendPrompt'),
                 mcpCommand=item['command'], mcpArgs=json.dumps(item.get('args', [])),
                 mcpEnv=mcp_env, mcpIsStateful=item.get('stateful', False)))
        if item.get('syncOnStart', True) and item.get('isActive', True):
            plan['sync'].append(item['path'])
    for full_path in plan['categories']:
        ancestor = full_path.rpartition('/')[0]
        while ancestor:
            if plan['categories'][ancestor]['type'] != 'LOCAL':
                raise ConfigError(f'Local configuration nested under gateway: {full_path}')
            ancestor = ancestor.rpartition('/')[0]
    return plan
