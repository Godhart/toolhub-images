from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import re

HEADER_SUFFIXES={".vh",".svh"}
VERILOG_SUFFIXES={".v",".sv"}
DIRECTIVE_RE=re.compile(r'^\s*`(?P<cmd>ifdef|ifndef|elsif|else|endif|define|undef|include)\b(?P<arg>.*)$')
INCLUDE_ARG_RE=re.compile(r'^\s*["<]([^">]+)[">]')
MACRO_INCLUDE_RE=re.compile(r'^\s*`([A-Za-z_]\w*)\s*$')
IDENT_RE=re.compile(r'^\s*([A-Za-z_]\w*)')

@dataclass(frozen=True)
class IncludeEdge:
    source: Path
    target: Path|None
    spelling: str
    line: int

@dataclass
class IncludeGraph:
    edges: dict[Path,list[IncludeEdge]]
    headers:set[Path]
    unresolved:list[IncludeEdge]
    def direct(self,p): return self.edges.get(p.resolve(),[])
    def transitive_headers(self,p):
        out=[]; seen=set()
        def walk(n):
            for e in self.direct(n):
                if e.target is not None and e.target not in seen:
                    seen.add(e.target); out.append(e.target); walk(e.target)
        walk(p.resolve()); return out

def parse_cli_defines(values):
    d={}
    for item in values:
        name, sep, val=item.partition("=")
        if not re.fullmatch(r"[A-Za-z_]\w*",name):
            raise ValueError(f"invalid macro name: {name!r}")
        d[name]=val if sep else "1"
    return d

def resolve_include(spelling, including, library_dir, include_dirs):
    p=Path(spelling)
    candidates=[p] if p.is_absolute() else [including.parent/p,*[x/p for x in include_dirs],library_dir/p]
    seen=set()
    for c in candidates:
        c=c.resolve()
        if c not in seen:
            seen.add(c)
            if c.is_file(): return c
    return None

def build_include_graph(root, compilation_units, include_dirs, initial_defines):
    root=root.resolve(); include_dirs=[p.resolve() for p in include_dirs]
    edges={}; headers=set(); unresolved=[]

    # Each compilation unit is a separate preprocessing context.
    def process(path, library_dir, macros, stack):
        path=path.resolve()
        if path in stack:
            chain=" -> ".join(str(x) for x in (*stack,path))
            raise ValueError(f"Verilog include cycle: {chain}")
        edges.setdefault(path,[])
        frames=[]  # (parent_active, branch_taken, active)
        active=True
        lines=path.read_text(encoding="utf-8",errors="replace").splitlines()
        in_block=False
        for lineno,raw in enumerate(lines,1):
            # Small lexical comment filter sufficient for preprocessor directives.
            line=raw
            if in_block:
                if "*/" in line:
                    line=line.split("*/",1)[1]; in_block=False
                else: continue
            while "/*" in line:
                a,b=line.split("/*",1)
                if "*/" in b: line=a+b.split("*/",1)[1]
                else: line=a; in_block=True; break
            line=line.split("//",1)[0]
            m=DIRECTIVE_RE.match(line)
            if not m: continue
            cmd,arg=m.group("cmd"),m.group("arg").strip()
            if cmd in ("ifdef","ifndef"):
                im=IDENT_RE.match(arg); name=im.group(1) if im else ""
                cond=(name in macros); cond=cond if cmd=="ifdef" else not cond
                parent=active; now=parent and cond
                frames.append([parent, bool(cond), now]); active=now
            elif cmd=="elsif":
                if not frames: raise ValueError(f"{path}:{lineno}: `elsif without `ifdef")
                im=IDENT_RE.match(arg); name=im.group(1) if im else ""
                parent,taken,_=frames[-1]; cond=(name in macros)
                now=parent and (not taken) and cond
                frames[-1]=[parent,taken or cond,now]; active=now
            elif cmd=="else":
                if not frames: raise ValueError(f"{path}:{lineno}: `else without `ifdef")
                parent,taken,_=frames[-1]; now=parent and not taken
                frames[-1]=[parent,True,now]; active=now
            elif cmd=="endif":
                if not frames: raise ValueError(f"{path}:{lineno}: `endif without `ifdef")
                frames.pop(); active=frames[-1][2] if frames else True
            elif not active:
                continue
            elif cmd=="define":
                im=IDENT_RE.match(arg)
                if im:
                    name=im.group(1); rest=arg[im.end():].strip()
                    # Function-like macros are recorded as defined; expansion is intentionally limited.
                    macros[name]=rest or "1"
            elif cmd=="undef":
                im=IDENT_RE.match(arg)
                if im: macros.pop(im.group(1),None)
            elif cmd=="include":
                spelling=None
                qm=INCLUDE_ARG_RE.match(arg)
                if qm: spelling=qm.group(1)
                else:
                    mm=MACRO_INCLUDE_RE.match(arg)
                    if mm:
                        value=macros.get(mm.group(1),"").strip()
                        qm=INCLUDE_ARG_RE.match(value)
                        if qm: spelling=qm.group(1)
                if spelling is None:
                    e=IncludeEdge(path,None,arg,lineno); edges[path].append(e); unresolved.append(e); continue
                target=resolve_include(spelling,path,library_dir,include_dirs)
                e=IncludeEdge(path,target,spelling,lineno); edges[path].append(e)
                if target is None: unresolved.append(e)
                else:
                    if target.suffix.lower() in HEADER_SUFFIXES: headers.add(target)
                    process(target,library_dir,macros,(*stack,path))
        if frames: raise ValueError(f"{path}: unterminated preprocessor conditional")

    for lib,path in compilation_units:
        if path.suffix.lower() in VERILOG_SUFFIXES:
            process(path,(root/lib).resolve(),dict(initial_defines),())
    return IncludeGraph(edges,headers,unresolved)
