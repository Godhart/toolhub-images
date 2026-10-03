"""End-to-end adapter tests. Requires built .sources/docsanity, Node 22 and Git."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'tools/okf_workspace/tool.py'
CLI = Path(os.environ.get('OKF_WORKSPACE_CLI', str(ROOT / '.sources/docsanity/dist/cli.js')))

class AdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.repo = cls.root / 'docs'
        cls.repo.mkdir()
        def git(*args):
            subprocess.run(['git', '-C', str(cls.repo), *args], check=True, capture_output=True)
        git('init')
        git('config', 'user.name', 'Test')
        git('config', 'user.email', 'test@localhost')
        (cls.repo / 'README.txt').write_text('Documentation source\n')
        git('add', '.')
        git('commit', '-m', 'initial')
        config = {'schema_version': 1, 'repositories': {'docs': {'path':str(cls.repo),'ref':'HEAD'}},
                  'domains':[{'id':'docs','title':'Docs','description':'Docs'}],
                  'coverage':[{'repository':'docs','prefix':'','domain':'docs'}], 'nodes':[]}
        cfg = cls.root / 'workspace.json'
        cfg.write_text(json.dumps(config))
        cls.env = dict(os.environ, OKF_WORKSPACE_STATE=str(cls.root / 'state'), OKF_WORKSPACE_CLI=str(CLI))
        CLI.chmod(0o755)
        subprocess.run([str(CLI), '--state', cls.env['OKF_WORKSPACE_STATE'], 'init', str(cfg)], env=cls.env, check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def call(self, operation, arguments=None, expected=0):
        r=subprocess.run([sys.executable,str(TOOL),json.dumps({'operation':operation,'arguments':arguments or {}})],
                         env=self.env,capture_output=True,text=True,timeout=35)
        self.assertEqual(r.returncode,expected,r.stdout+r.stderr)
        return json.loads(r.stdout)['result'] if expected == 0 else r

    def test_discovery_and_validation(self):
        self.assertIn('documentation_plan',[t['name'] for t in self.call('list_tools')])
        self.assertIn('changes_prepare',[t['name'] for t in self.call('describe_tools')])
        self.call('documentation_plan')
        bad=subprocess.run([sys.executable,str(TOOL),'{"operation":"not-a-tool"}'],env=self.env,capture_output=True)
        self.assertNotEqual(bad.returncode,0)
        bad=subprocess.run([sys.executable,str(TOOL),'{"operation":"snapshot_get","arguments":{"unknown":true}}'],env=self.env,capture_output=True)
        self.assertNotEqual(bad.returncode,0)
        spec=subprocess.run([sys.executable,str(TOOL),'{"describe":"json_spec"}'],env=self.env,check=True,capture_output=True,text=True)
        self.assertEqual(json.loads(spec.stdout)['name'],'okf_workspace')

    def test_file_input_with_open_stdin(self):
        request=self.root / 'request.json'
        request.write_text('{}')
        child=subprocess.Popen([str(CLI),'--state',self.env['OKF_WORKSPACE_STATE'],'call','snapshot_get',str(request)],
                               env=self.env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            self.assertEqual(child.wait(timeout=10),0)
            self.assertIn('snapshot',json.loads(child.stdout.read()))
        finally:
            if child.poll() is None:
                child.kill();child.wait()
            child.stdin.close();child.stdout.close();child.stderr.close()

    def test_create_update_and_export(self):
        snapshot=self.call('snapshot_get')['snapshot']
        content='---\ntype: Documentation\ntitle: Guide\n---\n\n# Guide {#guide}\n\nFirst version.\n'
        node={'id':'guide','kind':'document','domain':'docs','repository':'docs','path':'guide.md','title':'Guide','description':'Guide'}
        self.call('changes_prepare',{'base_snapshot':snapshot,'idempotency_key':'create-guide','message':'Create guide','operations':[{'action':'create','node':node,'content':content}]})
        self.assertEqual(self.call('snapshot_get')['snapshot'],snapshot)
        self.call('changes_apply',{'change_id':'create-guide'})
        doc=self.call('nodes_get',{'id':'guide','view':'full'})
        self.assertIn('First version',json.dumps(doc))
        self.call('changes_prepare',{'base_snapshot':self.call('snapshot_get')['snapshot'],'idempotency_key':'update-guide','message':'Update guide','operations':[{'action':'replace','id':'guide','expected_hash':doc['content_hash'],'content':content.replace('First version','Second version')}]})
        self.call('changes_apply',{'change_id':'update-guide'})
        self.assertTrue(self.call('catalog_validate')['valid'])
        self.call('documentation_coverage')
        target=self.root / 'export'
        subprocess.run([str(CLI),'--state',self.env['OKF_WORKSPACE_STATE'],'export',str(target)],env=self.env,check=True,capture_output=True)
        self.assertIn('Second version',(target/'docs/guide.md').read_text())
        self.assertFalse((self.repo/'guide.md').exists())

if __name__=='__main__':
    unittest.main()
