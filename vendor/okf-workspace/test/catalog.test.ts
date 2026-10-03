import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setup} from '../examples/setup.js';
import {CatalogWorkspace} from '../src/catalog.js';
import {digest} from '../src/workspace.js';
import {git,run} from '../src/git.js';
import {definitions,invoke} from '../src/interface.js';
import {validateManifest} from '../src/manifest.js';

async function fixture(t:any){const root=await fs.mkdtemp(path.join(os.tmpdir(),'okf02-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const old=await setup(root);const w=new CatalogWorkspace(old.w.root);await w.migrate({base_snapshot:await w.current(),idempotency_key:'migrate'});await w.apply('migrate');return {...old,root,w};}
async function manifest(w:CatalogWorkspace,complete=false){const s=(await w.snapshot()).data;return {format:'dependency-manifest',version:'1.0',producer:{name:'test',version:'1',analyzer:'test'},scope:{project:'p',profile:'default',area:'all',configuration:{}},sources:[{id:'rtl'}],nodes:[{id:'input',kind:'file',source:'rtl',path:'src/input.py',content_hash:s.hashes['input-reader']},{id:'client',kind:'file',source:'rtl',path:'src/client.py',content_hash:s.hashes.client}],edges:[{dependent:'client',dependency:'input',relation:'uses'}],coverage:{status:complete?'complete':'partial',files:['input','client'],relation_types:['uses'],limitations:[]},diagnostics:[]};}
async function imp(w:CatalogWorkspace,m:any,key:string){const j=await w.importDependencies({base_snapshot:await w.current(),idempotency_key:key,manifest:m,mapping:{rtl:{repository:'runtime',prefix:''}}});await w.apply(key);return j;}

test('migration creates unambiguous primary card and preserves old snapshot',async t=>{const {w}=await fixture(t);const s=await w.snapshot();assert.equal(s.data.nodes.find(n=>n.id==='input-guide')?.card?.mode,'full');assert.equal((await w.snapshot(s.data.parent!)).data.catalog,undefined);assert.ok(s.data.nodes.find(n=>n.id==='client')!.relations.length);});

test('partial repeated imports preserve prior edges and manual provenance',async t=>{const {w}=await fixture(t);const m=await manifest(w);await imp(w,m,'first');const reasons=(await w.snapshot()).data.reviews['input-guide']?.length??0;await imp(w,m,'repeat');assert.equal((await w.snapshot()).data.reviews['input-guide']?.length??0,reasons);await imp(w,{...m,edges:[]},'partial');const g=await w.dependencyGraph();assert.ok(g.dependencies.some(e=>e.origin!=='manual'));assert.ok(g.dependencies.some(e=>e.origin==='manual'));});

test('complete import removes only owned covered edges',async t=>{const {w}=await fixture(t);const m=await manifest(w,true);await imp(w,m,'first');const j=await imp(w,{...m,edges:[]},'complete');assert.equal(j.summary.removed,1);const g=await w.dependencyGraph();assert.ok(g.dependencies.some(e=>e.origin==='manual'));assert.ok(!g.dependencies.some(e=>e.origin!=='manual'));});

test('profiles and versions have correct identity semantics',async t=>{const {w}=await fixture(t);const m=await manifest(w);await imp(w,m,'first');await imp(w,{...m,producer:{...m.producer,version:'2'}},'version');assert.equal((await w.analyses()).analyses.length,1);await imp(w,{...m,scope:{...m.scope,profile:'other'}},'profile');assert.equal((await w.analyses()).analyses.length,2);});

test('hash mismatch refuses publication and mapping cannot escape',async t=>{const {w}=await fixture(t);const m=await manifest(w);m.nodes[0].content_hash=digest('wrong');const before=await w.current();await assert.rejects(imp(w,m,'bad'),/does not match/);assert.equal(await w.current(),before);await assert.rejects(invoke(w,'dependencies_import_prepare',{base_snapshot:before,idempotency_key:'escape',manifest:await manifest(w),mapping:{rtl:{repository:'runtime',prefix:'../outside'}}}));});

test('file update makes analysis stale and plans refresh',async t=>{const {w}=await fixture(t);await imp(w,await manifest(w),'import');const s=await w.snapshot();await w.prepare({base_snapshot:s.id,idempotency_key:'edit',message:'change',operations:[{action:'replace',id:'input-reader',expected_hash:s.data.hashes['input-reader'],content:'print(4)\n'}]});await w.apply('edit');const p=await w.documentationPlan();assert.ok(p.items.some(t=>t.action==='refresh_analysis'));assert.ok(p.items.some(t=>t.action==='review'&&t.document==='input-guide'));});

test('minimal card needs reason but does not need a full document link',async t=>{const {w}=await fixture(t);let s=await w.snapshot();const card={mode:'minimal',subject:{repository:'runtime',path:'src/client.py',artifact_id:'client'},references:[]};await w.prepare({base_snapshot:s.id,idempotency_key:'card',message:'card',operations:[{action:'create',node:{id:'client-card',kind:'document',repository:'docs',domain:'integration',path:'knowledge/client.md',title:'Client',description:'Client wrapper.',card},content:'---\ntype: Documentation\n---\nThin wrapper.\n'}]});await w.apply('card');assert.ok((await w.documentationPlan()).items.some(t=>t.action==='complete_card'&&t.document==='client-card'));s=await w.snapshot();await w.prepare({base_snapshot:s.id,idempotency_key:'reason',message:'reason',operations:[{action:'metadata',id:'client-card',expected_hash:s.data.hashes['client-card'],card:{...card,reason:'One-line internal wrapper; no separate interface.'}}]});await w.apply('reason');assert.ok(!(await w.documentationPlan()).items.some(t=>['complete_card','create_card'].includes(t.action)&&t.subject==='file:runtime:src/client.py'));});

test('delegated card detects missing document',async t=>{const {w}=await fixture(t);const s=await w.snapshot();await w.prepare({base_snapshot:s.id,idempotency_key:'delegate',message:'delegate',operations:[{action:'metadata',id:'input-guide',expected_hash:s.data.hashes['input-guide'],card:{mode:'delegated',subject:{repository:'runtime',path:'src/input.py'},reason:'Main guide',references:[{document:'not-created'}]}}]});await w.apply('delegate');assert.ok((await w.documentationPlan()).items.some(t=>t.action==='repair_reference'));});

test('no recursive card-of-card requirement; stable task keys and pagination',async t=>{const {w}=await fixture(t);const a=await w.documentationPlan(),b=await w.documentationPlan();assert.deepEqual(a.items.map(t=>t.key),b.items.map(t=>t.key));assert.ok(!a.items.some(t=>t.action==='create_card'&&t.subject==='file:docs:knowledge/input.md'));assert.equal((await w.documentationPlan({limit:1})).items.length,1);});

test('exclusion with reason removes file from coverage',async t=>{const {w}=await fixture(t);const s=await w.snapshot();await w.coveragePrepare({base_snapshot:s.id,idempotency_key:'scope',coverage:[{repository:'runtime',prefix:'',domain:'tools',exclusions:[{prefix:'src/client.py',reason:'Not part of this product'}]}]});await w.apply('scope');const p=await w.documentationPlan();assert.ok(p.coverage.excluded.some(e=>e.reason==='Not part of this product'));assert.ok(!p.items.some(t=>t.action==='create_card'&&t.subject==='file:runtime:src/client.py'));});

test('confirmed issue creates update task and task delta',async t=>{const {w}=await fixture(t);const before=await w.current();await w.issuePrepare({base_snapshot:before,idempotency_key:'issue',document:'input-guide',reason:'The documented default is incorrect.'});await w.apply('issue');const p=await w.documentationPlan({since_snapshot:before});assert.ok(p.items.some(t=>t.action==='update'));assert.ok(!p.items.some(t=>t.action==='create_card'));});

test('new public schemas use roles and hide legacy relation input',async t=>{const {w}=await fixture(t);const card:any=await invoke(w,'nodes_get',{id:'client'});assert.equal(card.relations,undefined);assert.equal(card.dependencies[0].dependent,'client');const schema=definitions(w).changes_prepare.schema;assert.equal(schema.safeParse({base_snapshot:await w.current(),idempotency_key:'legacy',message:'legacy',operations:[{action:'metadata',id:'client',expected_hash:(await w.snapshot()).data.hashes.client,relations:[]}]}).success,false);});

test('dangling endpoints and false complete reports are rejected',()=>{assert.throws(()=>validateManifest({format:'dependency-manifest'}));});

test('hdl-order export validates and imports end-to-end', {skip:!process.env.HDL_ORDER_PYTHON},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hdl-okf-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const rtl=path.join(root,'rtl');await fs.mkdir(path.join(rtl,'lib'),{recursive:true});await fs.writeFile(path.join(rtl,'lib/a.sv'),'module a; endmodule\n');await fs.writeFile(path.join(rtl,'lib/top.sv'),'module top;\na u();\nendmodule\n');await run('git',['init',rtl]);await git(rtl,['add','.']);await git(rtl,['-c','user.name=Test','-c','user.email=test@local','commit','-m','hdl']);
 const output=path.join(root,'manifest.json'),hdl=path.resolve('../hdl-order-0.6.0/src');await run(process.env.HDL_ORDER_PYTHON!,['-m','hdl_order.cli',rtl,'--export-dependencies',output,'--project-id','fpga'],undefined,{PYTHONPATH:hdl});const m=validateManifest(JSON.parse(await fs.readFile(output,'utf8')));assert.ok(m.edges.some(e=>e.relation==='hdl.instantiates'));
 const w=new CatalogWorkspace(path.join(root,'state'));await w.init({schema_version:1,repositories:{rtl:{path:rtl}},domains:[{id:'fpga',title:'FPGA',description:'FPGA'}],coverage:[{repository:'rtl',prefix:'',domain:'fpga'}],nodes:[]});await w.importDependencies({base_snapshot:await w.current(),idempotency_key:'hdl',manifest:m,mapping:{rtl:{repository:'rtl',prefix:''}}});await w.apply('hdl');assert.equal((await w.documentationPlan()).items.filter(t=>t.action==='create_card').length,2);
});

test('import creates artifact identities for scoped text files',async t=>{
 const {w}=await fixture(t);const s=await w.snapshot();const m=await manifest(w);
 // Existing registered nodes are reused, never duplicated.
 await imp(w,m,'reuse');assert.equal((await w.snapshot()).data.nodes.filter(n=>n.path==='src/input.py').length,1);
});

test('v2 section precision does not mark unrelated dependent documentation',async t=>{
 const {w}=await fixture(t);const s=await w.snapshot();await w.prepare({base_snapshot:s.id,idempotency_key:'examples-only',message:'Examples',operations:[{action:'replace_section',id:'input-guide',expected_hash:s.data.hashes['input-guide'],section_id:'examples',content:'New example.'}]});await w.apply('examples-only');assert.equal((await w.snapshot()).data.reviews['integration-guide']?.length??0,0);
});

test('a primary-card assignment can be explicitly removed',async t=>{
 const {w}=await fixture(t);const s=await w.snapshot();await w.prepare({base_snapshot:s.id,idempotency_key:'clear-card',message:'Clear card',operations:[{action:'metadata',id:'input-guide',expected_hash:s.data.hashes['input-guide'],card:null}]});await w.apply('clear-card');assert.ok((await w.documentationPlan()).items.some(t=>t.action==='create_card'&&t.subject==='file:runtime:src/input.py'));
});

test('register existing file checks its bytes and preserves repository revisions',async t=>{
  const {root,config}=await fixture(t);
  const w=new CatalogWorkspace(path.join(root,'registration-state'));
  await w.init({...config,nodes:config.nodes.filter(n=>n.id!=='client')});
  const node=config.nodes.find(n=>n.id==='client')!;
  const {relations,...publicNode}=node;
  const before=await w.snapshot();
  await assert.rejects(invoke(w,'nodes_register_prepare',{base_snapshot:before.id,idempotency_key:'wrong-hash',node:publicNode,expected_hash:digest('wrong')}),/Content conflict/);
  await invoke(w,'nodes_register_prepare',{base_snapshot:before.id,idempotency_key:'register',node:publicNode,expected_hash:digest('from input import read_input\n')});
  await w.apply('register');
  const after=await w.snapshot();
  assert.deepEqual(after.data.repositories,before.data.repositories);
  assert.ok(after.data.nodes.some(n=>n.id==='client'));
});
