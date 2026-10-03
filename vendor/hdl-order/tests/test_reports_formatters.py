import json
from hdl_order.project import analyze
from hdl_order.report import symbols_report, duplicate_report, check_report, headers_report, deps_report, explain
from hdl_order.formatters import FORMATTERS

def test_reports_and_formats(make_project):
    root=make_project({"lib/top.sv":'`include "x.svh"\nmodule top;endmodule',"lib/x.svh":"`define X 1"})
    r=analyze(root)
    assert "module" in symbols_report(r)
    assert "CHECK OK" in check_report(r)
    assert "x.svh" in headers_report(r)
    assert "[include x.svh]" in deps_report(r)
    assert "include x.svh" in explain(r,"lib/top.sv")
    assert "lib/top.sv" in FORMATTERS["plain"](r)
    obj=json.loads(FORMATTERS["json"](r)); assert obj["compile_order"][0]["file"]=="lib/top.sv"
    assert "index,library,file,type" in FORMATTERS["csv"](r)
    assert "vlog -sv" in FORMATTERS["modelsim"](r)

def test_duplicate_report(make_project):
    root=make_project({"lib/a.sv":"module x;endmodule","lib/b.sv":"module x;endmodule"})
    r=analyze(root)
    assert 'duplicate module "x"' in duplicate_report(r)
    assert "CHECK FAILED" in check_report(r)
