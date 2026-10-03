import json,csv,io,shlex
def plain(r): return "\n".join(f"{x.index:04d} {x.library:<20} {x.path}" for x in r.ordered)
def json_output(r):
    return json.dumps({"compile_order":[{"index":x.index,"library":x.library,"file":x.path.as_posix(),"type":x.file_type} for x in r.ordered],
      "defines":r.defines,"headers":[str(x) for x in sorted(r.include_graph.headers)]},indent=2)
def csv_output(r):
    o=io.StringIO();w=csv.writer(o);w.writerow(["index","library","file","type"])
    [w.writerow([x.index,x.library,x.path,x.file_type]) for x in r.ordered];return o.getvalue().rstrip()
def modelsim(r):
    ls=[];seen=set()
    for x in r.ordered:
        if x.library not in seen:seen.add(x.library);ls += [f"vlib {shlex.quote(x.library)}",f"vmap {shlex.quote(x.library)} {shlex.quote(x.library)}"]
    defs=" ".join(shlex.quote("+define+"+k+("=" + v if v!="1" else "")) for k,v in r.defines.items())
    incs=" ".join(shlex.quote("+incdir+"+str(p)) for p in r.include_dirs)
    for x in r.ordered:
        p=shlex.quote(x.path.as_posix());lib=shlex.quote(x.library)
        if x.file_type=="vhdl":ls.append(f"vcom -work {lib} {p}")
        else:ls.append(" ".join(z for z in ["vlog","-sv" if x.file_type=="systemverilog" else "", "-work",lib,defs,incs,p] if z))
    return "\n".join(ls)
FORMATTERS={"plain":plain,"json":json_output,"csv":csv_output,"modelsim":modelsim}
