import pytest
from hdl_order.project import discover
from hdl_order.symbols import build_symbol_index

@pytest.mark.xfail(reason="0.3 symbol scanner is intentionally not a full SV preprocessor/parser")
def test_macro_generated_module_is_not_yet_supported(make_project):
    root=make_project({"lib/a.sv":"`define DECL(N) module N; endmodule\n`DECL(foo)"})
    syms,_=build_symbol_index(discover(root))
    assert any(s.kind=="module" and s.name=="foo" for s in syms)
