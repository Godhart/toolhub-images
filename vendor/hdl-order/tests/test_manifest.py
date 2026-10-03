import json
from pathlib import Path
import pytest
import jsonschema
from hdl_order.project import analyze
from hdl_order.manifest import build_manifest, capture
from hdl_order.cli import parser, main
from hdl_order import __version__

def test_shared_schema_and_roles(make_project):
    root=make_project({'lib/child.sv':'module child; endmodule','lib/top.sv':'module top;\nchild u();\nendmodule'})
    m=build_manifest(analyze(root),'fpga')
    schema=json.loads((Path(__file__).parents[1]/'schemas/dependency-manifest.schema.json').read_text())
    jsonschema.validate(m,schema)
    assert m['producer']['version']==__version__=='0.7.0'
    assert any(e['dependent'].endswith('::top') and e['dependency'].endswith('::child') for e in m['edges'])
    assert all('target' not in e and 'source' not in e for e in m['edges'])
    assert m['coverage']['status']=='partial'

def test_export_cli(make_project,tmp_path,monkeypatch):
    root=make_project({'lib/x.sv':'module x; endmodule'})
    output=tmp_path/'deps.json'
    monkeypatch.setattr('sys.argv',['hdl-order',str(root),'--export-dependencies',str(output),'--project-id','demo','--analysis-profile','simulation'])
    assert main()==0
    m=json.loads(output.read_text());assert m['scope']['profile']=='simulation'
    assert not any('path' in r for r in m['sources'])

def test_input_changes_fail(make_project):
    root=make_project({'lib/x.sv':'module x; endmodule'})
    before=capture([root]);result=analyze(root)
    (root/'lib/x.sv').write_text('module y; endmodule')
    with pytest.raises(ValueError,match='changed during'):build_manifest(result,'demo',before=before)

def test_headers_and_multiple_units(make_project):
    root=make_project({'lib/defs.svh':'`define X 1\n','lib/x.sv':'`include "defs.svh"\nmodule a; endmodule\nmodule b; endmodule'})
    m=build_manifest(analyze(root),'demo')
    assert any(n.get('path','').endswith('.svh') for n in m['nodes'])
    assert len([n for n in m['nodes'] if n['kind']=='symbol'])==2
    assert any(e['relation']=='hdl.includes' for e in m['edges'])

def test_profile_and_defines_are_preserved(make_project):
    root=make_project({'lib/x.sv':'module x; endmodule'})
    m=build_manifest(analyze(root,defines={'SIM':'1'}),'demo','sim')
    assert m['scope']['configuration']['defines']=={'SIM':'1'}

def test_no_edges_inferred_from_order(make_project):
    root=make_project({'lib/a.sv':'module a; endmodule','lib/b.sv':'module b; endmodule'})
    assert not build_manifest(analyze(root),'demo')['edges']

def test_missing_project_rejected(make_project,tmp_path,monkeypatch):
    root=make_project({'lib/x.sv':'module x; endmodule'})
    monkeypatch.setattr('sys.argv',['hdl-order',str(root),'--export-dependencies',str(tmp_path/'x.json')])
    with pytest.raises(SystemExit):main()
