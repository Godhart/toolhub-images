import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from toolhub_config.config import ConfigError, load_config
from toolhub_config.database import apply_config, reconcile
from toolhub_config.cli import lock
ROOT=Path(__file__).resolve().parents[1]
ENV={'ADMIN':'admin-test','AGENT':'agent-test','REMOTE':'remote-test','MCP_TOKEN':'mcp-test'}

class LoaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.db=self.root/'hub.db'
        with sqlite3.connect(self.db) as db: db.executescript((ROOT/'tests/schema.sql').read_text())
        self.config=dict(version=1,settings={'adminPasswordEnv':'ADMIN','agentSecretEnv':'AGENT'},runners=[{'name':'Python','type':'python_local','config':{'codeFileName':'main.py','runCmd':'python main.py < /dev/null'}}],toolpacks=[{'file':'pack.json','runner':'Python'}])
        self.pack=json.loads((ROOT/'examples/packs/echo.toolpack').read_text())
    def plan(self,mode=None):
        (self.root/'pack.json').write_text(json.dumps(self.pack))
        path=self.root/'config.json'; path.write_text(json.dumps(self.config))
        return load_config(path,ENV,mode)
    def rows(self,table):
        with sqlite3.connect(self.db) as db: return db.execute(f'SELECT * FROM {table}').fetchall()
    def snapshot(self):
        with sqlite3.connect(self.db) as db: return '\n'.join(db.iterdump())
    def test_root_pack_tools_and_children(self):
        self.config['toolpacks'][0]['path']='/'
        child=dict(self.pack['category'], name='Child', slug='child', children=[])
        self.pack['category']['children']=[child]
        plan=self.plan()
        self.assertEqual(set(plan['tools']),{'/echo','/child/echo'})
        apply_config(self.db,plan)
        with sqlite3.connect(self.db) as db:
            paths={row[0] for row in db.execute('SELECT fullPath FROM Category')}
        self.assertEqual(paths,{'/','/child'})
        before=self.snapshot();apply_config(self.db,plan)
        self.assertEqual(before,self.snapshot())

    def test_root_packs_merge_and_detect_tool_collision(self):
        self.config['toolpacks'][0]['path']='/'
        other=json.loads(json.dumps(self.pack))
        other['category']['tools'][0].update(name='Other',slug='other')
        (self.root/'other.json').write_text(json.dumps(other))
        self.config['toolpacks'].append({'file':'other.json','path':'/','runner':'Python'})
        self.assertEqual(set(self.plan()['tools']),{'/echo','/other'})
        other['category']['tools'][0]['slug']='echo'
        (self.root/'other.json').write_text(json.dumps(other))
        with self.assertRaisesRegex(ConfigError,'Duplicate tool path: /echo'):self.plan()

    def test_repeat_keeps_ids_and_history(self):
        plan=self.plan(); apply_config(self.db,plan); before=self.snapshot(); apply_config(self.db,plan)
        self.assertEqual(before,self.snapshot()); self.assertEqual(len(self.rows('ToolVersion')),1)
    def test_update_without_duplicate(self):
        apply_config(self.db,self.plan()); tool_id=self.rows('Tool')[0][0]
        self.pack['category']['tools'][0]['code']='print(123)'; apply_config(self.db,self.plan())
        self.assertEqual(self.rows('Tool')[0][0],tool_id); self.assertEqual(len(self.rows('Tool')),1); self.assertEqual(len(self.rows('ToolVersion')),2)
    def test_merge_preserves_unlisted(self):
        apply_config(self.db,self.plan()); self.config['toolpacks']=[]; apply_config(self.db,self.plan()); self.assertEqual(len(self.rows('Tool')),1)
    def test_reset_backup_and_full_replacement(self):
        apply_config(self.db,self.plan())
        with sqlite3.connect(self.db) as db: db.execute("INSERT INTO ExecutionLog(path,durationMs,success) VALUES('/x',1,1)")
        before=self.snapshot(); self.config['toolpacks']=[]; result=apply_config(self.db,self.plan('reset'))
        for table in ('Tool','ToolVersion','ExecutionLog'): self.assertFalse(self.rows(table))
        with sqlite3.connect(result['backup']) as db: self.assertEqual(before,'\n'.join(db.iterdump()))
        self.assertEqual(Path(result['backup']).stat().st_mode & 0o777,0o600)
    def test_failed_reset_does_not_touch_db(self):
        apply_config(self.db,self.plan()); before=self.snapshot(); self.config['runners']=[]
        with self.assertRaises(ConfigError): apply_config(self.db,self.plan('reset'))
        self.assertEqual(before,self.snapshot()); self.assertFalse((self.root/'backups').exists())
    def test_check_does_not_mutate(self):
        before=self.snapshot(); apply_config(self.db,self.plan('reset'),check=True)
        self.assertEqual(before,self.snapshot()); self.assertFalse((self.root/'backups').exists())
    def test_rollback_late_error(self):
        apply_config(self.db,self.plan()); before=self.snapshot(); calls=[]
        def fail(db,plan):
            calls.append(1); result=reconcile(db,plan)
            if len(calls)==2: raise sqlite3.OperationalError('injected')
            return result
        self.config['settings']['rootPrompt']='new'
        with patch('toolhub_config.database.reconcile',side_effect=fail):
            with self.assertRaises(sqlite3.OperationalError): apply_config(self.db,self.plan())
        self.assertEqual(before,self.snapshot())
    def test_missing_env_and_unknown_field(self):
        self.config['settings']['adminPasswordEnv']='MISSING'
        with self.assertRaises(ConfigError): self.plan()
        self.config['settings']['adminPasswordEnv']='ADMIN'; self.config['typo']=True
        with self.assertRaises(ConfigError): self.plan()
    def test_unknown_pack_field_and_proxy(self):
        t=self.pack['category']['tools'][0]; t['typo']=1
        with self.assertRaises(ConfigError): self.plan()
        t.pop('typo'); t['isMcpProxy']=True
        with self.assertRaises(ConfigError): self.plan()
    def test_duplicate_yaml_keys(self):
        p=self.root/'bad.yaml'; p.write_text('version: 1\nversion: 1\n')
        with self.assertRaises(ConfigError): load_config(p,ENV)
    def test_duplicate_tools_and_categories(self):
        self.pack['category']['tools']*=2
        with self.assertRaises(ConfigError): self.plan()
        self.pack['category']['tools']=[]; self.config['toolpacks']*=2
        with self.assertRaises(ConfigError): self.plan()
    def test_remote_and_mcp_serialization(self):
        self.config['remotes']=[{'path':'/remote','url':'http://other-hub:3000','tokenEnv':'REMOTE'}]
        args=['','with space','a"b',"c'd",'back\\slash']
        self.config['mcp']=[{'path':'/mcp','command':'node','args':args,'env':{'FIXED':'x'},'envFrom':{'TOKEN':'MCP_TOKEN'},'stateful':True}]
        plan=self.plan(); apply_config(self.db,plan)
        with sqlite3.connect(self.db) as db:
            argv,env=db.execute("SELECT mcpArgs,mcpEnv FROM Category WHERE fullPath='/mcp'").fetchone()
        self.assertEqual(json.loads(argv),args); self.assertEqual(json.loads(env),{'FIXED':'x','TOKEN':'mcp-test'}); self.assertEqual(plan['sync'],['/mcp'])
    def test_cache_invalidation(self):
        self.config['mcp']=[{'path':'/mcp','command':'node','syncOnStart':False}]; apply_config(self.db,self.plan())
        with sqlite3.connect(self.db) as db: db.execute("UPDATE Category SET mcpToolsCache='{}' WHERE fullPath='/mcp'")
        apply_config(self.db,self.plan())
        with sqlite3.connect(self.db) as db: self.assertEqual(db.execute("SELECT mcpToolsCache FROM Category WHERE fullPath='/mcp'").fetchone()[0],'{}')
        self.config['mcp'][0]['command']='python'; plan=self.plan(); apply_config(self.db,plan)
        with sqlite3.connect(self.db) as db: self.assertIsNone(db.execute("SELECT mcpToolsCache FROM Category WHERE fullPath='/mcp'").fetchone()[0])
        self.assertEqual(plan['sync'],[])
    def test_nested_paths_type_change(self):
        self.config['toolpacks'][0]['path']='/a/b/c'; apply_config(self.db,self.plan()); self.assertEqual(len(self.rows('Category')),3)
        self.config['toolpacks']=[]; self.config['remotes']=[{'path':'/a','url':'http://other:3000','tokenEnv':'REMOTE'}]
        with self.assertRaises(ConfigError): apply_config(self.db,self.plan())
    def test_runner_no_fallback(self):
        self.config['toolpacks'][0]['runner']='NoSuchRunner'; before=self.snapshot()
        with self.assertRaises(ConfigError): apply_config(self.db,self.plan())
        self.assertEqual(before,self.snapshot())
    def test_single_tool_target(self):
        self.pack={'kind':'TOOLHUB_TOOL','version':1,'tool':self.pack['category']['tools'][0]}
        with self.assertRaises(ConfigError): self.plan()
        self.config['toolpacks'][0]['path']='/single'; apply_config(self.db,self.plan()); self.assertEqual(len(self.rows('Tool')),1)
    def test_lock(self):
        with lock(self.db):
            with self.assertRaises(ConfigError):
                with lock(self.db): pass
    def test_incompatible_or_missing_db(self):
        with self.assertRaises(ConfigError): apply_config(self.root/'missing.db',self.plan())
        self.assertFalse((self.root/'missing.db').exists())
        with sqlite3.connect(self.db) as db: db.execute('DROP TABLE ExecutionLog')
        with self.assertRaises(ConfigError): apply_config(self.db,self.plan())
    def test_bad_url_env_collision(self):
        self.config['remotes']=[{'path':'/remote','url':'http://user:secret@host','tokenEnv':'REMOTE'}]
        with self.assertRaises(ConfigError): self.plan()
        self.config['remotes']=[]; self.config['mcp']=[{'path':'/mcp','command':'x','env':{'TOKEN':'x'},'envFrom':{'TOKEN':'MCP_TOKEN'}}]
        with self.assertRaises(ConfigError): self.plan()
    def test_validation_does_not_echo_secrets(self):
        self.config['settings']['adminPassword']='sensitive-value'
        with self.assertRaises(ConfigError) as e: self.plan()
        self.assertNotIn('sensitive-value',str(e.exception))

if __name__=='__main__': unittest.main()
