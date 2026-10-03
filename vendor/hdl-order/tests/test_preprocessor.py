import pytest
from hdl_order.project import discover
from hdl_order.preprocessor import build_include_graph, parse_cli_defines

def graph(root, defs=None, inc=None):
    return build_include_graph(root, discover(root), inc or [], defs or {})

def test_recursive_headers(make_project):
    root=make_project({
      "lib/top.sv":'`include "inc/a.svh"\nmodule top; endmodule',
      "lib/inc/a.svh":'`include "b.vh"',
      "lib/inc/b.vh":'`define B 1'
    })
    g=graph(root)
    hs={p.name for p in g.transitive_headers(root/"lib/top.sv")}
    assert hs=={"a.svh","b.vh"}

def test_ifdef_selects_only_active_branch(make_project):
    root=make_project({
      "lib/top.sv":'`ifdef X\n`include "x.svh"\n`else\n`include "g.svh"\n`endif',
      "lib/x.svh":"", "lib/g.svh":""
    })
    g=graph(root,{"X":"1"})
    assert [e.spelling for e in g.direct(root/"lib/top.sv")]==["x.svh"]

def test_ifndef_else(make_project):
    root=make_project({
      "lib/top.sv":'`ifndef X\n`include "g.svh"\n`else\n`include "x.svh"\n`endif',
      "lib/x.svh":"", "lib/g.svh":""
    })
    g=graph(root,{})
    assert [e.spelling for e in g.direct(root/"lib/top.sv")]==["g.svh"]

def test_elsif(make_project):
    root=make_project({
      "lib/top.sv":'`ifdef A\n`include "a.svh"\n`elsif B\n`include "b.svh"\n`else\n`include "c.svh"\n`endif',
      "lib/a.svh":"", "lib/b.svh":"", "lib/c.svh":""
    })
    assert [e.spelling for e in graph(root,{"B":"1"}).direct(root/"lib/top.sv")]==["b.svh"]

def test_define_undef_changes_condition(make_project):
    root=make_project({
      "lib/top.sv":'`define X\n`ifdef X\n`include "a.svh"\n`endif\n`undef X\n`ifndef X\n`include "b.svh"\n`endif',
      "lib/a.svh":"", "lib/b.svh":""
    })
    assert [e.spelling for e in graph(root).direct(root/"lib/top.sv")]==["a.svh","b.svh"]

def test_macro_include(make_project):
    root=make_project({
      "lib/top.sv":'`define HDR "a.svh"\n`include `HDR',
      "lib/a.svh":""
    })
    assert graph(root).direct(root/"lib/top.sv")[0].target.name=="a.svh"

def test_include_search_I(make_project,tmp_path):
    root=make_project({"lib/top.sv":'`include "vendor.svh"'})
    inc=tmp_path/"vendor";inc.mkdir();(inc/"vendor.svh").write_text("")
    assert graph(root,inc=[inc]).direct(root/"lib/top.sv")[0].target== (inc/"vendor.svh").resolve()

def test_missing_include(make_project):
    root=make_project({"lib/top.sv":'`include "missing.svh"'})
    g=graph(root)
    assert len(g.unresolved)==1 and g.unresolved[0].spelling=="missing.svh"

def test_include_cycle(make_project):
    root=make_project({"lib/top.sv":'`include "a.svh"',"lib/a.svh":'`include "b.svh"',"lib/b.svh":'`include "a.svh"'})
    with pytest.raises(ValueError,match="include cycle"):
        graph(root)

def test_each_compilation_unit_has_independent_macro_context(make_project):
    root=make_project({
      "lib/a.sv":'`define LOCAL\n',
      "lib/b.sv":'`ifdef LOCAL\n`include "should_not.svh"\n`endif',
      "lib/should_not.svh":""
    })
    assert graph(root).direct(root/"lib/b.sv")==[]

def test_cli_define_parser():
    assert parse_cli_defines(["X","WIDTH=32"])=={"X":"1","WIDTH":"32"}
    with pytest.raises(ValueError): parse_cli_defines(["bad-name"])
