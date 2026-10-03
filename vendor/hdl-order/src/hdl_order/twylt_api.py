"""Typed TWYLT adapters. Importing schemas does not initialize VUnit."""
from __future__ import annotations
from contextlib import redirect_stdout
from pathlib import Path
import sys
import json
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")

class AnalysisInput(Model):
    root: str = Field(..., min_length=1, description="HDL project directory; each immediate subdirectory is a library. Relative to process cwd.")
    config: str | None = Field(None, description="Optional TOML file with explicit dependencies; relative to process cwd.")
    include_dirs: list[str] = Field(default_factory=list, description="Ordered additional include directories; relative to process cwd.")
    defines: dict[str,str] = Field(default_factory=dict, description="Preprocessor definitions, for example {SIM: '1'}.")
    allow_missing_includes: bool = Field(False, description="Report unresolved includes instead of aborting.")

class OrderInput(AnalysisInput):
    render: Literal["plain","csv","modelsim"] | None = Field(None, description="Optional additional rendered compile-order text. No commands are executed.")
class GraphInput(AnalysisInput):
    render: Literal["text","dot"] | None = Field(None, description="Optional additional graph rendering.")
class DependenciesInput(AnalysisInput):
    file: str | None = Field(None, description="Optional project-relative file to explain. Omit for all includes and explicit dependencies.")
class ManifestInput(AnalysisInput):
    project_id: str = Field(..., min_length=1, description="Stable project identity in dependency-manifest scope.")
    analysis_profile: str = Field("default", min_length=1, description="Analysis profile, e.g. simulation or synthesis.")

class CompilationUnit(Model):
    index: int
    library: str
    file: str
    type: str
class OrderOutput(Model):
    compile_order: list[CompilationUnit]
    defines: dict[str,str]
    headers: list[str]
    rendered: str | None = None
class Symbol(Model):
    library: str
    kind: str
    name: str
    owner: str | None = None
    file: str
    line: int
class SymbolsOutput(Model):
    symbols: list[Symbol]
class CheckOutput(Model):
    ok: bool
    compilation_units: int
    design_units: int
    headers: int
    duplicates: list[list[Symbol]]
    unresolved_includes: int
class Unit(Model):
    id: str
    library: str
    kind: str
    name: str
    file: str
    line: int
class MapOutput(Model):
    units: list[Unit]
class UnitEdge(Model):
    dependent: str
    dependency: str
    relation: str
    file: str
    line: int
class GraphOutput(Model):
    nodes: list[Unit]
    edges: list[UnitEdge]
    completeness: Literal["partial"] = "partial"
    rendered: str | None = None
class IncludeEdge(Model):
    dependent: str
    dependency: str | None
    spelling: str
    line: int
class ExplicitEdge(Model):
    dependent: str
    dependency: str
    reason: str | None = None
class DependenciesOutput(Model):
    includes: list[IncludeEdge]
    explicit: list[ExplicitEdge]
    completeness: Literal["include-and-explicit-only"] = "include-and-explicit-only"
    explanation: str | None = None
class Header(Model):
    file: str
    used_by: list[str]
class HeadersOutput(Model):
    headers: list[Header]
    unresolved: list[IncludeEdge]

# Model the shared manifest, retaining arbitrary analyzer configuration/attributes.
class Producer(Model):
    name: str
    version: str
    analyzer: str
class Scope(Model):
    project: str
    profile: str
    area: str
    configuration: dict[str,Any]
class Source(Model):
    id: str
    revision: str | None = None
class FileNode(Model):
    id: str
    kind: Literal["file"]
    source: str
    path: str
    content_hash: str
class SymbolNode(Model):
    id: str
    kind: Literal["symbol"]
    name: str
    file: str
    attributes: dict[str,Any]
    line: int | None = None
class ExternalNode(Model):
    id: str
    kind: Literal["external"]
    name: str
    uri: str | None = None
class Evidence(Model):
    file: str
    line: int | None = None
    precision: Literal["file","symbol","line"]
class Edge(Model):
    dependent: str
    dependency: str
    relation: str
    evidence: Evidence | None = None
    note: str | None = None
class Coverage(Model):
    status: Literal["partial","complete"]
    files: list[str]
    relation_types: list[str]
    limitations: list[str]
class Diagnostic(Model):
    severity: Literal["info","warning","error"]
    code: str
    message: str
class Manifest(Model):
    format: Literal["dependency-manifest"]
    version: Literal["1.0"]
    producer: Producer
    scope: Scope
    sources: list[Source]
    nodes: list[FileNode | SymbolNode | ExternalNode]
    edges: list[Edge]
    coverage: Coverage
    diagnostics: list[Diagnostic]
class ManifestOutput(Model):
    # Keep original JSON exactly (no inserted nulls) for import into the strict
    # shared schema. Runtime validation against Manifest happens before return.
    manifest: dict[str,Any] = Field(..., json_schema_extra=json.loads(Path(__file__).with_name("manifest_output_schema.json").read_text(encoding="utf-8")), description="Unmodified dependency-manifest 1.0 object, ready for dependencies_import_prepare.manifest.")


def analyze_input(data):
    from .project import analyze
    root=Path(data.root)
    if not root.is_dir():
        raise ValueError(f"Not a project directory: {root}")
    # VUnit diagnostics must never contaminate TWYLT JSON stdout.
    with redirect_stdout(sys.stderr):
        return analyze(root,Path(data.config) if data.config else None,
                       [Path(p) for p in data.include_dirs],data.defines,data.allow_missing_includes)


def execute(mode,data):
    from .report import rel,explain
    before=None
    if mode=="manifest":
        from .manifest import capture
        before=capture([Path(data.root),*(Path(p) for p in data.include_dirs)])
    r=analyze_input(data)
    def symbol(s):
        return dict(library=s.library,kind=s.kind,name=s.name,owner=s.owner,file=rel(r,s.path),line=s.line)
    def include(e):
        return dict(dependent=rel(r,e.source),dependency=rel(r,e.target) if e.target else None,spelling=e.spelling,line=e.line)
    units=[dict(id=u.label(),library=u.library,kind=u.kind,name=u.name,file=rel(r,p),line=n)
           for u,(p,n) in sorted(r.unit_map.items())]
    if mode=="order":
        from .formatters import FORMATTERS
        return dict(compile_order=[dict(index=x.index,library=x.library,file=x.path.as_posix(),type=x.file_type) for x in r.ordered],
                    defines=r.defines,headers=[rel(r,h) for h in sorted(r.include_graph.headers)],
                    rendered=FORMATTERS[data.render](r) if data.render else None)
    if mode=="check":
        return dict(ok=not r.duplicates and not r.include_graph.unresolved,compilation_units=len(r.ordered),
                    design_units=len(r.symbols),headers=len(r.include_graph.headers),
                    duplicates=[[symbol(s) for s in group] for group in r.duplicates.values()],
                    unresolved_includes=len(r.include_graph.unresolved))
    if mode=="symbols": return dict(symbols=[symbol(s) for s in r.symbols])
    if mode=="map": return dict(units=units)
    if mode=="graph":
        from .unitreport import graph_dot,graph_text
        rendered=None
        if data.render=="dot": rendered=graph_dot(r)
        if data.render=="text": rendered=graph_text(r)
        return dict(nodes=units,edges=[dict(dependent=e.source.label(),dependency=e.target.label(),relation=e.relation,file=rel(r,e.path),line=e.line) for e in r.unit_edges],rendered=rendered)
    if mode=="dependencies":
        focus=None
        if data.file:
            focus=(r.root/data.file).resolve()
            if not focus.is_relative_to(r.root) or not focus.is_file():
                raise ValueError("file must be an existing file inside the project root")
        includes=[include(e) for src,es in sorted(r.include_graph.edges.items()) for e in es if focus is None or src.resolve()==focus]
        explicit=[dict(dependent=rel(r,a),dependency=rel(r,b),reason=reason) for a,b,reason in r.explicit if focus is None or a.resolve()==focus]
        return dict(includes=includes,explicit=explicit,explanation=explain(r,data.file) if focus else None)
    if mode=="headers":
        return dict(headers=[dict(file=rel(r,h),used_by=[rel(r,r.root/x.path) for x in r.ordered if h in r.include_graph.transitive_headers((r.root/x.path).resolve())]) for h in sorted(r.include_graph.headers)],
                    unresolved=[include(e) for e in r.include_graph.unresolved])
    if mode=="manifest":
        from .manifest import build_manifest
        manifest=build_manifest(r,data.project_id,data.analysis_profile,before)
        Manifest.model_validate(manifest)
        return dict(manifest=manifest)
    raise ValueError(f"Unknown mode: {mode}")
