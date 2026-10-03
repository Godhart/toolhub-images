import subprocess,sys

def run(root,*args):
    return subprocess.run([sys.executable,"-m","hdl_order.cli",str(root),*args],text=True,capture_output=True)

def test_cli_check_success(make_project):
    root=make_project({"lib/a.sv":"module a;endmodule"})
    p=run(root,"--check"); assert p.returncode==0 and "CHECK OK" in p.stdout

def test_cli_check_duplicate_exit_1(make_project):
    root=make_project({"lib/a.sv":"module x;endmodule","lib/b.sv":"module x;endmodule"})
    p=run(root,"--check"); assert p.returncode==1 and "CHECK FAILED" in p.stdout

def test_cli_missing_include_exit_2(make_project):
    root=make_project({"lib/a.sv":'`include "missing.svh"\nmodule a;endmodule'})
    p=run(root); assert p.returncode==2 and "unresolved" in p.stderr

def test_cli_modes(make_project):
    root=make_project({"lib/a.sv":"module a;endmodule"})
    for mode in ("--symbols","--deps","--headers"):
        assert run(root,mode).returncode==0
