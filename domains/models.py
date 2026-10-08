"""Validated domain source of truth. No filesystem mutations here."""
import ipaddress
import re
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator, field_validator

Name = Annotated[str, Field(pattern=r'^[a-z][a-z0-9-]{0,47}$')]
Env = dict[str, str | int | float | bool]

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Limits(Strict):
    containers: int = Field(2, ge=1)
    tmp: str = Field('512m', pattern=r'^[1-9][0-9]*[kKmMgG]$')
    pids: int = Field(128, ge=16)
    mem: str = Field('2g', pattern=r'^[1-9][0-9]*[kKmMgG]$')
    cpu: float = Field(2, gt=0, allow_inf_nan=False)

class LimitOverrides(Strict):
    containers: int | None = Field(None, ge=1)
    tmp: str | None = Field(None, pattern=r'^[1-9][0-9]*[kKmMgG]$')
    pids: int | None = Field(None, ge=16)
    mem: str | None = Field(None, pattern=r'^[1-9][0-9]*[kKmMgG]$')
    cpu: float | None = Field(None, gt=0, allow_inf_nan=False)

class Domain(Strict):
    name: Name
    uid: int = Field(1000, ge=0)
    gid: int = Field(1000, ge=0)
    host: str = '127.0.0.1'
    port_base: int = Field(3300, ge=1024, le=65535)
    path: str
    tools: str = 'tools'
    workspace: str = 'workspace'
    network: StrictBool = True
    env: Env = Field(default_factory=dict)
    env_router: Env = Field(default_factory=dict)
    limits: Limits = Field(default_factory=Limits)
    admin_pass: str = Field(min_length=1, repr=False)
    agent_pass: str = Field(min_length=1, repr=False)
    seed_lang: Literal['ru','en','zh'] = 'ru'

    @field_validator('host')
    @classmethod
    def host_ip(cls, value):
        # Accept the draft's trailing colon on IPv4.
        if value.endswith(':') and value.count(':') == 1:
            value = value[:-1]
        ipaddress.ip_address(value)
        return value

class Options(Strict):
    abs_paths: bool = True
    remove_unused_tools: bool = False
    reset_settings: bool = True

class Source(Strict):
    path: str | None = None
    ref: str = 'main'
    update: Literal['always','once'] = 'once'

    @model_validator(mode='before')
    @classmethod
    def legacy_url(cls, value):
        value = dict(value)
        if 'url' in value and 'path' not in value:
            value['path'] = value.pop('url')
        return value

    @field_validator('ref')
    @classmethod
    def git_ref(cls, value):
        if not value or value.startswith('-') or any(c.isspace() for c in value):
            raise ValueError('invalid Git ref')
        return value

class Toolset(Strict):
    name: Name
    source_kind: Literal['git','local','manual']
    tools_kind: Literal['twylt'] = 'twylt'
    data: Source = Field(default_factory=Source)

    @model_validator(mode='before')
    @classmethod
    def legacy_kind(cls, value):
        value = dict(value)
        if 'kind' in value and 'source_kind' not in value:
            value['source_kind'] = value.pop('kind')
        return value

    @model_validator(mode='after')
    def required_path(self):
        if self.source_kind != 'manual' and not self.data.path:
            raise ValueError('git/local toolset requires data.path')
        return self

class Pack(Strict):
    toolset: Name
    prefix: str | None = None
    exclude: list[str] = Field(default_factory=list)
    toolpak_builder_kwargs: dict = Field(default_factory=dict)

    @model_validator(mode='before')
    @classmethod
    def spelling(cls, value):
        value = dict(value)
        for old, new in [('ptoolseth','toolset'), ('toolpack_builder_kwargs','toolpak_builder_kwargs')]:
            if old in value and new not in value:
                value[new] = value.pop(old)
        return value

    @model_validator(mode='after')
    def options(self):
        if self.prefix is not None and not re.fullmatch(r'/?[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*', self.prefix):
            raise ValueError('prefix must be a nonempty ToolHub category path')
        allowed = {'glob','excludes','python','probe_timeout','category_mode','timeout_ms'}
        if set(self.toolpak_builder_kwargs) - allowed:
            raise ValueError('unsupported toolpack-builder option')
        if self.toolpak_builder_kwargs.get('category_mode','single') not in ('single','directories'):
            raise ValueError('invalid category_mode')
        for field in ('probe_timeout','timeout_ms'):
            if field in self.toolpak_builder_kwargs and (not isinstance(self.toolpak_builder_kwargs[field],(int,float)) or self.toolpak_builder_kwargs[field] <= 0):
                raise ValueError('builder deadlines must be positive')
        return self

class Hub(Strict):
    name: Name
    image: str = Field(min_length=1)
    env: Env = Field(default_factory=dict)
    port: int | None = Field(None, ge=1, le=65535)
    kind: Literal['general','docker'] = 'general'
    network: StrictBool | None = None
    packs: list[Pack] = Field(default_factory=list)
    limits: LimitOverrides = Field(default_factory=LimitOverrides)
    mcps: list = Field(default_factory=list)
    docker_socket: str = '/var/run/docker.sock'
    docker_socket_gid: int | None = Field(None, ge=0)
    docker_workspace: Literal['host-readonly','none'] = 'host-readonly'

    @model_validator(mode='after')
    def current_scope(self):
        if self.mcps:
            raise ValueError('worker MCP integration is not implemented in this iteration')
        if self.name == 'mcp':
            raise ValueError('hub name mcp is reserved for the bridge')
        if len({p.toolset for p in self.packs}) != len(self.packs):
            raise ValueError('each toolset may occur only once per hub')
        paths = ['/' + (p.prefix or p.toolset).strip('/') for p in self.packs]
        if len(paths) != len(set(paths)):
            raise ValueError('duplicate pack prefix')
        return self

class Bridge(Strict):
    enabled: bool = True
    image: str = 'toolhub-mcp-bridge:base'
    port: int = Field(100, ge=1, le=65535)

class Config(Strict):
    domain: Domain
    options: Options = Field(default_factory=Options)
    toolsets: list[Toolset] = Field(default_factory=list)
    hubs: list[Hub] = Field(default_factory=list)
    bridge: Bridge = Field(default_factory=Bridge)

    @model_validator(mode='after')
    def references(self):
        names = [t.name for t in self.toolsets]
        if len(names) != len(set(names)) or len({h.name for h in self.hubs}) != len(self.hubs):
            raise ValueError('duplicate toolset/hub name')
        ports = [0] + [h.port for h in self.hubs if h.port is not None]
        if self.bridge.enabled:
            ports.append(self.bridge.port)
        if len(ports) != len(set(ports)) or max(ports) + self.domain.port_base > 65535:
            raise ValueError('duplicate or overflowing published ports')
        for hub in self.hubs:
            for pack in hub.packs:
                if pack.toolset not in names:
                    raise ValueError('hub refers to an unknown toolset')
        for env in [self.domain.env, self.domain.env_router] + [h.env for h in self.hubs]:
            for key, value in env.items():
                if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',key):
                    raise ValueError('invalid environment key')
                if key in {'TOOLHUB_CONFIG','TOOLHUB_CONFIG_MODE','DATABASE_URL','PORT',
                           'TOOLHUB_ADMIN_PASSWORD','TOOLHUB_AGENT_PASSWORD','TOOLHUB_AGENT_SECRET',
                           'TOOLHUB_URL','WORKSPACE_HOST_PATH','TWYLT_WORKSPACE_ROOT','DOCKER_HOST',
                           'TWYLT_DOCKER_MAX_CONTAINERS','TWYLT_DOCKER_DISABLE_NETWORK','TWYLT_DISABLE_NETWORK'}:
                    raise ValueError('environment key is owned by domain generator')
                if any(c in str(value) for c in '\r\n\x00'):
                    raise ValueError('multiline environment values are not supported')
        for value in [self.domain.admin_pass, self.domain.agent_pass]:
            if any(c in value for c in '\r\n\x00'):
                raise ValueError('multiline passwords are not supported')
        return self
