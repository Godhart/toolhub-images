from dataclasses import dataclass
import re
@dataclass(frozen=True,order=True)
class UnitRef:
 library:str; kind:str; name:str
 def label(self): return f"{self.library}::{self.kind}::{self.name}"
@dataclass(frozen=True)
class UnitEdge:
 source:UnitRef; target:UnitRef; relation:str; path:object; line:int
def build_unit_map(symbols): return {UnitRef(s.library,s.kind,f"{s.owner}.{s.name}" if s.owner else s.name):(s.path,s.line) for s in symbols}
def build_unit_edges(root,discovered,symbols):
 um=build_unit_map(symbols); lookup={(u.library,u.kind,u.name):u for u in um}; out=[]; seen=set(); by={}
 for s in symbols: by.setdefault(s.path,[]).append(s)
 def add(a,b,r,p,n):
  k=(a,b,r,p,n)
  if a and b and a!=b and k not in seen: seen.add(k); out.append(UnitEdge(a,b,r,p,n))
 for lib,path in discovered:
  text=path.read_text(errors="replace"); text=re.sub(r"/\*.*?\*/","",text,flags=re.S); text=re.sub(r"//[^\n]*|--[^\n]*","",text); lines=text.splitlines(); ss=sorted(by.get(path,[]),key=lambda x:x.line)
  for i,s in enumerate(ss):
   body="\n".join(lines[s.line-1:(ss[i+1].line-1 if i+1<len(ss) else len(lines))]); src=UnitRef(s.library,s.kind,f"{s.owner}.{s.name}" if s.owner else s.name)
   if path.suffix.lower() in (".vhd",".vhdl"):
    for m in re.finditer(r"(?i)\buse\s+(\w+)\.(\w+)\.",body):
     l=m.group(1).lower(); l=lib if l=="work" else l; add(src,lookup.get((l,"package",m.group(2).lower())),"uses",path,s.line)
    for m in re.finditer(r"(?i)\bentity\s+(\w+)\.(\w+)",body):
     l=m.group(1).lower(); l=lib if l=="work" else l; add(src,lookup.get((l,"entity",m.group(2).lower())),"direct-instantiates",path,s.line)
    if s.kind=="architecture": add(src,lookup.get((lib,"entity",s.owner)),"architecture-of",path,s.line)
    if s.kind=="package_body": add(src,lookup.get((lib,"package",s.name)),"package-body-of",path,s.line)
   else:
    for m in re.finditer(r"\bimport\s+([A-Za-z_]\w*)::",body): add(src,lookup.get((lib,"package",m.group(1))),"imports",path,s.line)
    for m in re.finditer(r"\b([A-Za-z_]\w*)::[A-Za-z_*]\w*",body): add(src,lookup.get((lib,"package",m.group(1))),"references-package",path,s.line)
    for m in re.finditer(r"(?m)^\s*([A-Za-z_]\w*)\s+(?:#\s*\([^;]*?\)\s*)?([A-Za-z_]\w*)\s*\(",body,re.S): add(src,lookup.get((lib,"module",m.group(1))) or lookup.get((lib,"interface",m.group(1))),"instantiates",path,s.line)
 return out
