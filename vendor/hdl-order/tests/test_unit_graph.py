import json
from hdl_order.project import analyze
from hdl_order.unitreport import unit_map_json,graph_dot
def test_multiple_units_one_file(make_project):
 r=analyze(make_project({"lib/x.sv":"package p;endpackage\nmodule a;endmodule\nmodule b;endmodule"})); assert len(json.loads(unit_map_json(r)))==3
def test_package_edge(make_project):
 r=analyze(make_project({"lib/x.sv":"package p;typedef logic t;endpackage\nmodule a; import p::*; p::t x; endmodule"})); assert any(e.target.label()=="lib::package::p" for e in r.unit_edges)
def test_instantiation_edge(make_project):
 r=analyze(make_project({"lib/x.sv":"module child;endmodule\nmodule top;\nchild u();\nendmodule"})); assert any(e.source.label()=="lib::module::top" and e.target.label()=="lib::module::child" for e in r.unit_edges)
def test_library_identity(make_project):
 r=analyze(make_project({"a/x.sv":"module x;endmodule","b/x.sv":"module x;endmodule"})); assert {"a::module::x","b::module::x"} <= {u.label() for u in r.unit_map}
def test_dot(make_project): assert graph_dot(analyze(make_project({"lib/x.sv":"module x;endmodule"}))).startswith("digraph hdl_units")
