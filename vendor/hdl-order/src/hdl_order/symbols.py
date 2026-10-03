from dataclasses import dataclass
from pathlib import Path
from .lexer import lex

@dataclass(frozen=True)
class Symbol:
    library:str; kind:str; name:str; owner:str|None; path:Path; line:int
    @property
    def key(self):
        return (self.library,self.kind,self.owner,self.name) if self.kind=="architecture" else (self.library,self.kind,self.name)

def scan_file(path:Path,library:str):
    path=Path(path); vhdl=path.suffix.lower() in (".vhd",".vhdl")
    ts=lex(path.read_text(errors="replace"),path,"vhdl" if vhdl else "sv"); out=[]; i=0
    low=lambda t:t.value.lower()
    while i<len(ts):
        w=low(ts[i])
        if vhdl:
            if w=="package" and i+2<len(ts) and low(ts[i+1])=="body" and ts[i+2].kind=="identifier":
                out.append(Symbol(library,"package_body",low(ts[i+2]),None,path,ts[i].line)); i+=3; continue
            if w=="package" and i+1<len(ts) and ts[i+1].kind=="identifier":
                out.append(Symbol(library,"package",low(ts[i+1]),None,path,ts[i].line)); i+=2; continue
            if w=="entity" and i+1<len(ts) and ts[i+1].kind=="identifier":
                out.append(Symbol(library,"entity",low(ts[i+1]),None,path,ts[i].line)); i+=2; continue
            if w=="architecture" and i+3<len(ts) and ts[i+1].kind=="identifier" and low(ts[i+2])=="of" and ts[i+3].kind=="identifier":
                out.append(Symbol(library,"architecture",low(ts[i+1]),low(ts[i+3]),path,ts[i].line)); i+=4; continue
        else:
            kinds={"module":"module","interface":"interface","package":"package","program":"program"}
            if w in kinds:
                j=i+1
                if j<len(ts) and low(ts[j]) in ("automatic","static"): j+=1
                if j<len(ts) and ts[j].kind=="identifier":
                    out.append(Symbol(library,kinds[w],ts[j].value,None,path,ts[i].line)); i=j+1; continue
        i+=1
    return out

def scan_symbols(root,discovered):
    out=[]
    for library,paths in discovered.items():
        for p in paths:
            if Path(p).suffix.lower() in (".vhd",".vhdl",".v",".sv"): out.extend(scan_file(Path(p),library))
    return out

def duplicates(symbols):
    by={}
    for s in symbols: by.setdefault(s.key,[]).append(s)
    return {k:v for k,v in by.items() if len(v)>1}

def build_symbol_index(discovered):
    """Build the design-unit list and duplicate index from discover() output."""
    symbols=[]
    for library,path in discovered:
        if Path(path).suffix.lower() in (".vhd",".vhdl",".v",".sv"):
            symbols.extend(scan_file(Path(path),library))
    return symbols,duplicates(symbols)
