from pathlib import Path
def rel(r,p):
    try:return p.resolve().relative_to(r.root).as_posix()
    except ValueError:return p.resolve().as_posix()

def symbols_report(r):
    lines=[]
    for s in sorted(r.symbols,key=lambda x:(x.library,x.kind,x.owner or "",x.name,rel(r,x.path),x.line)):
        name=f"{s.owner}.{s.name}" if s.owner else s.name
        lines.append(f"{s.library:<16} {s.kind:<14} {name:<30} {rel(r,s.path)}:{s.line}")
    return "\n".join(lines) or "(no design units found)"

def duplicate_report(r):
    lines=[]
    for _,items in sorted(r.duplicates.items(),key=lambda kv:str(kv[0])):
        s=items[0]; name=f"{s.owner}.{s.name}" if s.owner else s.name
        lines.append(f'duplicate {s.kind} "{name}" in library "{s.library}":')
        for x in items: lines.append(f"  {rel(r,x.path)}:{x.line}")
    return "\n".join(lines)

def check_report(r):
    if r.duplicates: return "CHECK FAILED\n"+duplicate_report(r)
    return f"CHECK OK: {len(r.ordered)} compilation units, {len(r.symbols)} design units, {len(r.include_graph.headers)} headers"

def headers_report(r):
    users={h:[] for h in r.include_graph.headers}
    for x in r.ordered:
        src=(r.root/x.path).resolve()
        for h in r.include_graph.transitive_headers(src): users.setdefault(h,[]).append(src)
    lines=[]
    for h in sorted(users,key=lambda p:rel(r,p)):
        lines.append(rel(r,h))
        for u in users[h]: lines.append("  <- "+rel(r,u))
    return "\n".join(lines) or "(no headers)"

def deps_report(r):
    lines=["# includes"]
    n=0
    for src in sorted(r.include_graph.edges,key=lambda p:rel(r,p)):
        for e in r.include_graph.edges[src]:
            n+=1; dst=rel(r,e.target) if e.target else "<missing>"
            lines.append(f"{rel(r,src)}:{e.line} -> {dst} [include {e.spelling}]")
    if not n: lines.append("(none)")
    lines.append("# explicit compile dependencies")
    if not r.explicit: lines.append("(none)")
    for a,b,why in r.explicit: lines.append(f"{rel(r,a)} -> {rel(r,b)}"+(f" [{why}]" if why else ""))
    return "\n".join(lines)

def explain(r,name):
    p=(r.root/name).resolve() if not Path(name).is_absolute() else Path(name).resolve()
    if not p.exists(): raise ValueError(f"file does not exist: {name}")
    lines=[rel(r,p)]; seen={p}
    def walk(node,prefix):
        es=r.include_graph.direct(node)
        for i,e in enumerate(es):
            last=i==len(es)-1; b="└─" if last else "├─"; nxt=prefix+("   " if last else "│  ")
            if e.target is None: lines.append(f"{prefix}{b} include {e.spelling} -> MISSING"); continue
            lines.append(f"{prefix}{b} include {e.spelling} -> {rel(r,e.target)}")
            if e.target not in seen: seen.add(e.target); walk(e.target,nxt)
    walk(p,"")
    for a,b,why in r.explicit:
        if a.resolve()==p: lines.append(f"└─ explicit -> {rel(r,b)}"+(f" ({why})" if why else ""))
    if len(lines)==1: lines.append("└─ no hdl-order-visible include/explicit dependencies")
    return "\n".join(lines)
