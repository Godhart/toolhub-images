import json
def rel(r,p):
 try:return p.resolve().relative_to(r.root).as_posix()
 except:return p.as_posix()
def unit_map_text(r): return "\n".join(f"{u.label():<55} -> {rel(r,p)}:{n}" for u,(p,n) in sorted(r.unit_map.items()))
def unit_map_json(r): return json.dumps([{"library":u.library,"kind":u.kind,"name":u.name,"file":rel(r,p),"line":n} for u,(p,n) in sorted(r.unit_map.items())],indent=2)
def graph_text(r): return "\n".join(f"{e.source.label()} --{e.relation}--> {e.target.label()}" for e in r.unit_edges) or "(no unit dependencies)"
def graph_json(r): return json.dumps({"nodes":[{"id":u.label(),"library":u.library,"kind":u.kind,"name":u.name,"file":rel(r,p),"line":n} for u,(p,n) in sorted(r.unit_map.items())],"edges":[{"source":e.source.label(),"target":e.target.label(),"relation":e.relation,"file":rel(r,e.path),"line":e.line} for e in r.unit_edges]},indent=2)
def graph_dot(r):
 a=["digraph hdl_units {","  rankdir=LR;"]
 for u in sorted(r.unit_map): a.append(f'  "{u.label()}" [label="{u.library}\\n{u.kind}: {u.name}"];')
 for e in r.unit_edges:a.append(f'  "{e.source.label()}" -> "{e.target.label()}" [label="{e.relation}"];')
 return "\n".join(a+["}"])
