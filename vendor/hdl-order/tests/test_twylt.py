"""Real TWYLT transport and contract tests; no subprocess mocks."""
import json
import os
from pathlib import Path
import subprocess
import sys
import pytest
import jsonschema

ROOT=Path(__file__).parents[1]
MODES=['order','check','symbols','map','graph','dependencies','headers','manifest']

def call(mode,payload=None,*,cwd=None,env=None,stdin='',file_input=False):
    args=[sys.executable,str(ROOT/'tools'/f'hdl-{mode}'/'run.py')]
    if payload is not None and not file_input: args.append(json.dumps(payload))
    if file_input: (cwd/'input.json').write_text(json.dumps(payload))
    e={**os.environ,'PYTHONPATH':str(ROOT/'src'),**(env or {})}
    return subprocess.run(args,input=stdin,text=True,capture_output=True,cwd=cwd or ROOT,env=e,timeout=30)

@pytest.mark.parametrize('mode',MODES)
def test_real_tools_and_output_schema(mode,make_project,tmp_path):
    root=make_project({'lib/defs.svh':'`define VALUE 1\n','lib/child.sv':'module child; endmodule','lib/top.sv':'`include "defs.svh"\nmodule top;\nchild u();\nendmodule'})
    payload={'root':str(root)}
    if mode=='manifest':payload.update(project_id='demo',analysis_profile='simulation')
    p=call(mode,payload,cwd=tmp_path)
    assert p.returncode==0,p.stderr
    result=json.loads(p.stdout)
    spec=call(mode,{'describe':'json_spec'},cwd=tmp_path)
    assert spec.returncode==0,spec.stderr
    contract=json.loads(spec.stdout)
    jsonschema.validate(result,contract['outputSchema'])
    assert contract['name']==f'hdl-{mode}'
    assert contract['version']=='0.7.0'
    assert contract['inputSchema']['additionalProperties'] is False
    if mode=='order':
        assert [x['file'] for x in result['compile_order']].index('lib/child.sv')<[x['file'] for x in result['compile_order']].index('lib/top.sv')
    elif mode=='check':assert result['ok'] is True
    elif mode=='graph':
        assert any(e['dependent'].endswith('::top') and e['dependency'].endswith('::child') for e in result['edges'])
        assert all('source' not in e and 'target' not in e for e in result['edges'])
    elif mode=='headers':assert result['headers'][0]['used_by']==['lib/top.sv']
    elif mode=='manifest':
        m=result['manifest'];assert m['scope']['profile']=='simulation'
        jsonschema.validate(m,json.loads((ROOT/'schemas/dependency-manifest.schema.json').read_text()))
        assert not (tmp_path/'dependencies.json').exists()

@pytest.mark.parametrize('mode',MODES)
def test_strict_inputs(mode,tmp_path):
    args={'root':str(tmp_path),'typo':True}
    if mode=='manifest':args['project_id']='p'
    p=call(mode,args,cwd=tmp_path)
    assert p.returncode==2
    assert json.loads(p.stderr)['error']['source']=='twylt'
    assert not p.stdout.strip()

def test_stdin_and_file_transport(make_project,tmp_path):
    root=make_project({'lib/x.sv':'module x; endmodule'})
    request={'root':str(root)}
    p=call('order',stdin=json.dumps(request),cwd=tmp_path)
    assert p.returncode==0,p.stderr
    expected=json.loads(p.stdout)
    p=call('order',request,file_input=True,cwd=tmp_path)
    assert p.returncode==0,p.stderr
    assert not p.stdout.strip()
    assert json.loads((tmp_path/'output.json').read_text())==expected

def test_business_error_is_structured(tmp_path):
    p=call('order',{'root':str(tmp_path/'absent')},cwd=tmp_path)
    assert p.returncode==5
    err=json.loads(p.stderr)['error']
    assert err['source']=='tool' and err['stage']=='biz'

def test_missing_project_id_is_validation_error(tmp_path):
    p=call('manifest',{'root':str(tmp_path)},cwd=tmp_path)
    assert p.returncode==2
    assert 'project_id' in p.stderr

def test_describe_without_hdl_import(tmp_path):
    script='''import sys
from twylt.bootstrap import run_tool_file
class Block:
    def find_spec(self,fullname,*args):
        if fullname.startswith('hdl_order'): raise ModuleNotFoundError(fullname)
sys.meta_path.insert(0,Block())
run_tool_file(sys.argv[1])
'''
    for mode in MODES:
        for describe in ['requirements','json_spec']:
            p=subprocess.run([sys.executable,'-c',script,str(ROOT/'tools'/f'hdl-{mode}'/'tool.py')],env={**os.environ,'INPUT_DESCRIBE':describe},text=True,capture_output=True,timeout=10)
            assert p.returncode==0,p.stderr
            result=json.loads(p.stdout)
            if describe=='requirements':assert 'hdl-order[twylt]==0.7.0' in result['content']
            else:
                assert result['name']==f'hdl-{mode}'
                assert result['inputSchema']=={} and result['outputSchema']=={}

def test_render_and_explain(make_project,tmp_path):
    root=make_project({'lib/h.svh':'`define X 1\n','lib/x.sv':'`include "h.svh"\nmodule x; endmodule'})
    p=call('order',{'root':str(root),'render':'modelsim'},cwd=tmp_path)
    assert p.returncode==0,p.stderr
    assert 'vlog' in json.loads(p.stdout)['rendered']
    p=call('dependencies',{'root':str(root),'file':'lib/x.sv'},cwd=tmp_path)
    assert p.returncode==0,p.stderr
    data=json.loads(p.stdout)
    assert data['includes'][0]['dependency']=='lib/h.svh'
    assert 'h.svh' in data['explanation']

def test_missing_include_check_is_not_ok(make_project,tmp_path):
    root=make_project({'lib/x.sv':'`include "absent.svh"\nmodule x; endmodule'})
    p=call('check',{'root':str(root),'allow_missing_includes':True},cwd=tmp_path)
    assert p.returncode==0,p.stderr
    result=json.loads(p.stdout)
    assert result['ok'] is False and result['unresolved_includes']==1

def test_all_few_shots_execute():
    for mode in MODES:
        p=call(mode,{'describe':'json_spec'})
        assert p.returncode==0,p.stderr
        for ex in json.loads(p.stdout)['few_shots']:
            result=call(mode,ex['input'])
            assert result.returncode==0,result.stderr
            assert json.loads(result.stdout)==ex['output']
