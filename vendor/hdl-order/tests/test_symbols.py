from hdl_order.project import discover
from hdl_order.symbols import build_symbol_index

def test_vhdl_symbols_and_case_insensitive_duplicate(make_project):
    root=make_project({
      "lib/a.vhd": "entity Foo is end;\narchitecture RTL of Foo is begin end;\npackage Pkg is end package;\npackage body Pkg is end package body;",
      "lib/b.vhd": "entity fOO is end;"
    })
    syms,dups=build_symbol_index(discover(root))
    assert any(s.kind=="entity" and s.name=="foo" for s in syms)
    assert any(s.kind=="architecture" and s.owner=="foo" and s.name=="rtl" for s in syms)
    assert any(s.kind=="package" and s.name=="pkg" for s in syms)
    assert any(s.kind=="package_body" and s.name=="pkg" for s in syms)
    assert ("lib","entity","foo") in dups

def test_two_vhdl_architectures_are_allowed(make_project):
    root=make_project({
      "lib/e.vhd":"entity fifo is end;",
      "lib/a.vhd":"architecture rtl of fifo is begin end;",
      "lib/b.vhd":"architecture behavioral of fifo is begin end;"
    })
    _,dups=build_symbol_index(discover(root))
    assert not dups

def test_duplicate_architecture_is_detected(make_project):
    root=make_project({
      "lib/a.vhd":"architecture rtl of fifo is begin end;",
      "lib/b.vhd":"architecture RTL of FIFO is begin end;"
    })
    _,dups=build_symbol_index(discover(root))
    assert ("lib","architecture","fifo","rtl") in dups

def test_sv_symbols_case_sensitive(make_project):
    root=make_project({
      "lib/a.sv":"module Foo; endmodule\ninterface Bus; endinterface\npackage P; endpackage\nprogram Prog; endprogram",
      "lib/b.sv":"module foo; endmodule"
    })
    syms,dups=build_symbol_index(discover(root))
    assert {s.kind for s in syms} >= {"module","interface","package","program"}
    assert not dups

def test_same_name_in_different_libraries_not_duplicate(make_project):
    root=make_project({"a/x.sv":"module m; endmodule","b/x.sv":"module m; endmodule"})
    _,dups=build_symbol_index(discover(root))
    assert not dups

def test_build_symbol_index_compatibility(tmp_path):
    from hdl_order.symbols import build_symbol_index
    p=tmp_path/'a.sv'; p.write_text('module a; endmodule\n')
    symbols,dups=build_symbol_index([('lib',p)])
    assert [(s.library,s.kind,s.name) for s in symbols]==[('lib','module','a')]
    assert dups=={}
