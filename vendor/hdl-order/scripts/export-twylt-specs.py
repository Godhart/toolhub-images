"""Run after installing .[twylt]; export the actual bootstrap JSON contracts."""
from pathlib import Path
import json
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
out=root/'schemas/twylt'
out.mkdir(parents=True,exist_ok=True)
for tool in sorted((root/'tools').glob('*/run.py')):
    p=subprocess.run([sys.executable,str(tool),'{"describe":"json_spec"}'],cwd=root,
                     capture_output=True,text=True,check=True,timeout=30)
    spec=json.loads(p.stdout)
    (out/(spec['name']+'.json')).write_text(json.dumps(spec,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(spec['name'])
