from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import tomllib
from .vunit_adapter import VUnitAdapter
from .preprocessor import build_include_graph
from .symbols import build_symbol_index
from .unitdeps import build_unit_map, build_unit_edges

HDL_SUFFIXES={".vhd",".vhdl",".v",".sv"}

@dataclass(frozen=True)
class OrderedSource:
    index:int; library:str; path:Path; file_type:str
@dataclass
class Result:
    root:Path; ordered:list; include_graph:object; explicit:list; include_dirs:list
    symbols:list; duplicates:dict; defines:dict; unit_map:dict; unit_edges:list

def ftype(p):
    return "vhdl" if p.suffix.lower() in (".vhd",".vhdl") else ("verilog" if p.suffix.lower()==".v" else "systemverilog")

def discover(root):
    root=root.resolve(); out=[]
    for d in sorted(x for x in root.iterdir() if x.is_dir()):
        for p in sorted(x for x in d.rglob("*") if x.is_file() and x.suffix.lower() in HDL_SUFFIXES):
            out.append((d.name,p.resolve()))
    return out

def _project_relative(path,root):
    p=Path(path).resolve()
    try:return p.relative_to(root)
    except ValueError:return p

def analyze(root,config=None,include_dirs=None,defines=None,allow_missing=False):
    root=root.resolve(); inc=[p.resolve() for p in (include_dirs or [])]; defines=defines or {}
    disc=discover(root)
    symbols,duplicates=build_symbol_index(disc)
    unit_map=build_unit_map(symbols)
    unit_edges=build_unit_edges(root,disc,symbols)
    ig=build_include_graph(root,disc,inc,defines)
    if ig.unresolved and not allow_missing:
        msg="\n".join(f"  {e.source.relative_to(root)}:{e.line}: {e.spelling}" for e in ig.unresolved)
        raise ValueError("unresolved `include directives:\n"+msg)

    adapter=VUnitAdapter();vu=adapter.vu; libs={}; by={}
    for lib,_ in disc:
        if lib not in libs: libs[lib]=vu.add_library(lib)
    for lib,p in disc:
        typ=ftype(p); kw={"file_type":typ}
        if typ in ("verilog","systemverilog"):
            # Pass project defines to VUnit too.
            kw["include_dirs"]=[str(x) for x in dict.fromkeys([p.parent,*inc,root/lib])]
            kw["defines"]=defines
        src=libs[lib].add_source_file(p,**kw); by[p.relative_to(root).as_posix()]=src

    data=tomllib.loads(config.read_text()) if config else {}
    explicit=[]
    for x in data.get("dependency",[]):
        a=Path(x["file"]).as_posix(); b=Path(x["depends_on"]).as_posix()
        if a not in by or b not in by: raise ValueError(f"unknown explicit dependency: {a} -> {b}")
        by[a].add_dependency_on(by[b]); explicit.append((root/a,root/b,x.get("reason")))

    # VUnit performs semantic dependency ordering and cycle detection here.
    try:
        order=adapter.compile_order()
    except Exception as e:
        raise ValueError(f"semantic compile dependency analysis failed (possible cycle): {e}") from e
    ordered=[OrderedSource(i,adapter.library_name(s),_project_relative(s.name,root),ftype(Path(s.name))) for i,s in enumerate(order,1)]
    return Result(root,ordered,ig,explicit,inc,symbols,duplicates,defines,unit_map,unit_edges)
