import pytest
from hdl_order.project import analyze

def test_cross_library_vhdl_compile_order(make_project):
    root=make_project({
      "lib_a/a_pkg.vhd":"package a_pkg is constant N:natural:=1; end package;",
      "lib_b/b_pkg.vhd":"library lib_a; use lib_a.a_pkg.all; package b_pkg is constant M:natural:=N; end package;",
      "lib_a/a_impl.vhd":"library lib_b; use lib_b.b_pkg.all; entity a_impl is end; architecture rtl of a_impl is begin end;"
    })
    r=analyze(root)
    names=[x.path.as_posix() for x in r.ordered]
    assert names.index("lib_a/a_pkg.vhd") < names.index("lib_b/b_pkg.vhd") < names.index("lib_a/a_impl.vhd")

def test_headers_not_compilation_units(make_project):
    root=make_project({"lib/top.sv":'`include "x.svh"\nmodule top; endmodule',"lib/x.svh":"`define X 1"})
    r=analyze(root)
    assert [x.path.as_posix() for x in r.ordered]==["lib/top.sv"]

def test_missing_include_is_error_by_default(make_project):
    root=make_project({"lib/top.sv":'`include "x.svh"\nmodule top; endmodule'})
    with pytest.raises(ValueError,match="unresolved"):
        analyze(root)

def test_allow_missing_include(make_project):
    root=make_project({"lib/top.sv":'`include "x.svh"\nmodule top; endmodule'})
    r=analyze(root,allow_missing=True)
    assert len(r.include_graph.unresolved)==1

def test_explicit_dependency(make_project,tmp_path):
    root=make_project({"lib/a.sv":"module a;endmodule","lib/b.sv":"module b;endmodule"})
    cfg=tmp_path/"c.toml"
    cfg.write_text('[[dependency]]\nfile="lib/b.sv"\ndepends_on="lib/a.sv"\nreason="test"\n')
    r=analyze(root,config=cfg)
    names=[x.path.as_posix() for x in r.ordered]
    assert names.index("lib/a.sv") < names.index("lib/b.sv")
    assert r.explicit[0][2]=="test"

def test_explicit_dependency_unknown_file(make_project,tmp_path):
    root=make_project({"lib/a.sv":"module a;endmodule"})
    cfg=tmp_path/"c.toml";cfg.write_text('[[dependency]]\nfile="lib/a.sv"\ndepends_on="lib/no.sv"\n')
    with pytest.raises(ValueError,match="unknown explicit"):
        analyze(root,config=cfg)
