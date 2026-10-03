from pathlib import Path
import vunit
from hdl_order.vunit_adapter import VUnitAdapter
def test_vunit_version():assert vunit.__version__=="4.7.1"
def test_adapter_compile_order(tmp_path):
    a=tmp_path/"a.sv";b=tmp_path/"b.sv";a.write_text("package p; endpackage\n");b.write_text("module b; import p::*; endmodule\n")
    x=VUnitAdapter();sa=x.add_source("lib",a,"systemverilog",[tmp_path],{"X":"1"});sb=x.add_source("lib",b,"systemverilog",[tmp_path],{});sb.add_dependency_on(sa)
    order=[x.source_path(q) for q in x.compile_order()];assert order.index(a.resolve())<order.index(b.resolve())
def test_no_builtins(tmp_path):
    a=tmp_path/"a.vhd";a.write_text("entity a is\nend entity;\n")
    x=VUnitAdapter();x.add_source("lib",a,"vhdl");assert [x.source_path(q) for q in x.compile_order()]==[a.resolve()]
