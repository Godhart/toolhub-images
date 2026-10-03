import { test } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setup, guide } from '../examples/setup.js';
import { Workspace, digest } from '../src/workspace.js';
import { git, gitText, readJson, atomicJson, run } from '../src/git.js';
import { sections } from '../src/markdown.js';
import { server } from '../src/interface.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

async function fixture(t: any, single = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, ...await setup(root, single) };
}
async function replace(w: Workspace, key: string, id = 'input-reader', content = 'print("updated")\n') {
  const s = await w.snapshot();
  return { base_snapshot: s.id, idempotency_key: key, message: key, operations: [{ action: 'replace', id, expected_hash: s.data.hashes[id], content }] };
}

test('docs-only update leaves artifact commit and source files unchanged', async t => {
  const { w, runtime } = await fixture(t); const before = await w.snapshot();
  const original = await fs.readFile(path.join(runtime, 'src/input.py'), 'utf8');
  await w.prepare(await replace(w, 'docs-only', 'input-guide', guide.replace('one JSON', 'a JSON')));
  assert.equal(await w.current(), before.id);
  await w.apply('docs-only'); const after = await w.snapshot();
  assert.equal(after.data.repositories.runtime, before.data.repositories.runtime);
  assert.notEqual(after.data.repositories.docs, before.data.repositories.docs);
  assert.equal(await fs.readFile(path.join(runtime, 'src/input.py'), 'utf8'), original);
});

test('joint multi-repository update publishes one snapshot and marks indirect dependents', async t => {
  const { w } = await fixture(t); const before = await w.snapshot();
  const request = await replace(w, 'joint');
  request.operations.push({ action: 'replace', id: 'input-guide', expected_hash: before.data.hashes['input-guide'], content: guide.replace('one JSON', 'a JSON') });
  await w.prepare(request); await w.apply('joint');
  const after = await w.snapshot();
  assert.notEqual(after.data.repositories.runtime, before.data.repositories.runtime);
  assert.notEqual(after.data.repositories.docs, before.data.repositories.docs);
  for (const id of ['input-guide', 'client', 'integration-guide']) assert.ok(after.data.reviews[id].length);
  assert.equal(after.data.reviews['integration-guide'].some(r => r.source === 'input-reader'), true);
  assert.ok((await w.get('input-reader', 'full', [], before.id) as any).content.includes('return {}'));
  assert.equal((await w.validate()).valid, true);
});

test('same repository works with one content commit', async t => {
  const { w } = await fixture(t, true); const before = await w.snapshot();
  await w.prepare(await replace(w, 'one-repo')); await w.apply('one-repo');
  const after = await w.snapshot();
  assert.equal(Object.keys(after.data.repositories).length, 1);
  assert.equal(await gitText(w.repo('runtime'), ['rev-parse', after.data.repositories.runtime + '^']), before.data.repositories.runtime);
});

test('section dependency ignores unrelated section change, observes referenced section change', async t => {
  const { w } = await fixture(t); let s = await w.snapshot();
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'examples', message: 'Examples', operations: [{ action: 'replace_section', id: 'input-guide', expected_hash: s.data.hashes['input-guide'], section_id: 'examples', content: 'New examples.' }] });
  await w.apply('examples'); s = await w.snapshot();
  assert.equal(s.data.reviews['integration-guide']?.length ?? 0, 0);
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'protocol', message: 'Protocol', operations: [{ action: 'replace_section', id: 'input-guide', expected_hash: s.data.hashes['input-guide'], section_id: 'protocol', content: 'New protocol.' }] });
  await w.apply('protocol'); assert.ok((await w.snapshot()).data.reviews['integration-guide'].length);
});

test('stale base and expected content hash reject writes', async t => {
  const { w } = await fixture(t); const old = await replace(w, 'old');
  await assert.rejects(w.prepare({ ...old, idempotency_key: 'wrong-hash', operations: [{ ...old.operations[0], expected_hash: digest('wrong') }] }), /conflict/);
  await w.prepare(await replace(w, 'new')); await w.apply('new');
  await assert.rejects(w.prepare(old), /conflict/);
});

test('two prepared candidates cannot overwrite each other', async t => {
  const { w } = await fixture(t);
  await w.prepare(await replace(w, 'first')); await w.prepare(await replace(w, 'second'));
  await w.apply('first'); await assert.rejects(w.apply('second'), /conflict/);
});

test('idempotency guards payload and survives later commits', async t => {
  const { w } = await fixture(t); const r = await replace(w, 'retry');
  const j = await w.prepare(r); assert.equal((await w.prepare(r)).candidate, j.candidate);
  await assert.rejects(w.prepare({ ...r, message: 'changed' }), /Idempotency/);
  await w.apply('retry'); await w.prepare(await replace(w, 'later', 'input-reader', 'print(2)\n')); await w.apply('later');
  assert.equal((await w.apply('retry')).snapshot, j.candidate);
  assert.notEqual(await w.current(), j.candidate);
});

test('validation failure across repositories publishes nothing', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  const request = await replace(w, 'bad-doc');
  request.operations.push({ action: 'replace', id: 'input-guide', expected_hash: s.data.hashes['input-guide'], content: 'not valid frontmatter' });
  await assert.rejects(w.prepare(request), /frontmatter/);
  assert.equal(await w.current(), s.id); assert.equal((await w.changeGet('bad-doc')).status, 'failed');
});

test('failure after content commits leaves previous snapshot visible', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  w.retain = async () => { throw new Error('simulated disk failure'); };
  await assert.rejects(w.prepare(await replace(w, 'fail')), /simulated/);
  assert.equal(await w.current(), s.id);
  assert.equal((await w.get('input-reader', 'full') as any).content, 'def read_input():\n    return {}\n');
});

test('crash after CAS is reconciled from Git state', async t => {
  const { w } = await fixture(t); const j = await w.prepare(await replace(w, 'crash'));
  await git(w.control, ['update-ref', 'refs/heads/current', j.candidate!, j.base]);
  assert.equal((await readJson<any>(w.journal('crash'))).status, 'prepared');
  assert.equal((await w.changeGet('crash')).status, 'applied');
  assert.equal((await w.apply('crash')).status, 'applied');
});

test('review requires known reason IDs and persists evidence without changing artifacts', async t => {
  const { w } = await fixture(t); await w.prepare(await replace(w, 'update')); await w.apply('update');
  const s = await w.snapshot(), reasons = s.data.reviews['input-guide'];
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'review', message: 'Verified guide', operations: [{ action: 'review', id: 'input-guide', expected_hash: s.data.hashes['input-guide'], reason_ids: reasons.map(r => r.id), evidence: 'Compared guide against reader revision.', actor: 'process:test' }] });
  await w.apply('review'); const next = await w.snapshot();
  assert.equal(next.data.reviews['input-guide'].length, 0);
  assert.equal(next.data.repositories.runtime, s.data.repositories.runtime);
  assert.equal(next.data.based_on['input-guide']['input-reader'], next.data.hashes['input-reader']);
  assert.equal(next.data.review_history.at(-1)?.actor, 'process:test');
  assert.ok(next.data.reviews.client.length);
});

test('create artifact without document; move preserves stable ID; unsafe paths rejected', async t => {
  const { w } = await fixture(t); let s = await w.snapshot();
  const node = { id: 'extra', kind: 'artifact', domain: 'tools', repository: 'runtime', path: 'src/extra.py', title: 'Extra', description: 'Extra tool' };
  await assert.rejects(w.prepare({ base_snapshot: s.id, idempotency_key: 'unsafe', message: 'Unsafe', operations: [{ action: 'create', node: { ...node, path: '../outside.py' }, content: 'x' }] }));
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'create', message: 'New artifact', operations: [{ action: 'create', node, content: 'print(1)\n' }] });
  await w.apply('create'); s = await w.snapshot();
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'move', message: 'Move artifact', operations: [{ action: 'move', id: 'extra', expected_hash: s.data.hashes.extra, path: 'lib/extra.py' }] });
  await w.apply('move'); assert.equal((await w.get('extra')).path, 'lib/extra.py');
});

test('deleting referenced node rejects dangling relations', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  await assert.rejects(w.prepare({ base_snapshot: s.id, idempotency_key: 'delete', message: 'Delete', operations: [{ action: 'delete', id: 'input-reader', expected_hash: s.data.hashes['input-reader'] }] }), /Dangling/);
});

test('Markdown parser ignores fenced headings and keeps stable anchor through title change', () => {
  const text = guide + '\n```md\n## Fake {#fake}\n```\n';
  assert.equal(sections(text).some(s => s.id === 'fake'), false);
  assert.equal(sections(text.replace('## Protocol', '## New protocol')).find(s => s.id === 'protocol')?.title, 'New protocol');
  assert.throws(() => sections(guide + '\n## Again {#protocol}\n'), /Duplicate/);
});

test('cycles terminate and cross-domain reviews propagate', async t => {
  const { w } = await fixture(t); let s = await w.snapshot();
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'cycle', message: 'Add reverse dependency', operations: [{ action: 'metadata', id: 'input-reader', expected_hash: s.data.hashes['input-reader'], relations: [{ type: 'depends_on', target: 'client' }] }] });
  await w.apply('cycle'); await w.prepare(await replace(w, 'cycle-change')); await w.apply('cycle-change');
  s = await w.snapshot(); assert.ok(s.data.reviews.client.length); assert.ok(s.data.reviews['input-guide'].length);
});

test('OKF search, stable section reads and immutable MCP resource work', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  const mcp = server(w), client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([mcp.connect(a), client.connect(b)]);
  t.after(async () => { await client.close(); await mcp.close(); });
  const tools = (await client.listTools()).tools.map(t => t.name);
  assert.ok(tools.includes('changes_prepare')); assert.ok(!tools.includes('write_concept'));
  const result: any = await client.callTool({ name: 'docs_search', arguments: { query: 'JSON', snapshot: s.id } });
  assert.ok(JSON.parse(result.content[0].text).hits.some((h: any) => h.id === 'input-guide'));
  const resource = await client.readResource({ uri: `catalog://${s.id}/input-guide` });
  assert.ok(String((resource.contents[0] as any).text).includes('input.json'));
  const outline = await w.get('input-guide', 'sections', ['protocol']); assert.ok((outline as any).sections[0].content.includes('JSON'));
  const request = await replace(w, 'mcp-change');
  const prepared: any = await client.callTool({ name: 'changes_prepare', arguments: request });
  assert.ok(!prepared.isError, prepared.content[0].text);
  const applied: any = await client.callTool({ name: 'changes_apply', arguments: { change_id: 'mcp-change' } });
  assert.equal(JSON.parse(applied.content[0].text).status, 'applied');
});

test('export preserves Git tree and snapshot metadata', async t => {
  const { w, root, runtime } = await fixture(t);
  const dest = path.join(root, 'export'); await w.exportSnapshot(dest);
  assert.equal(await fs.readFile(path.join(dest, 'runtime/src/input.py'), 'utf8'), await fs.readFile(path.join(runtime, 'src/input.py'), 'utf8'));
  assert.ok(await fs.readFile(path.join(dest, 'snapshot.json'), 'utf8'));
  await assert.rejects(w.exportSnapshot(dest), /must not exist/);
});

test('pinned hashes preserve historical reads and suppress new-version review', async t => {
  const { w } = await fixture(t); let s = await w.snapshot();
  const old = s.data.hashes['input-reader'];
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'pin', message: 'Pin client', operations: [{ action: 'metadata', id: 'client', expected_hash: s.data.hashes.client, relations: [{ type: 'depends_on', target: 'input-reader', target_hash: old }] }] });
  await w.apply('pin'); s = await w.snapshot();
  const count = s.data.reviews.client.length;
  await w.prepare(await replace(w, 'next-version')); await w.apply('next-version'); s = await w.snapshot();
  assert.equal(s.data.reviews.client.length, count);
  assert.equal((await w.get('input-reader', 'full', [], undefined, old)).content, 'def read_input():\n    return {}\n');
});

test('unknown pinned content hashes are rejected', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  await assert.rejects(w.prepare({ base_snapshot: s.id, idempotency_key: 'bad-pin', message: 'Bad pin', operations: [{ action: 'metadata', id: 'client', expected_hash: s.data.hashes.client, relations: [{ type: 'depends_on', target: 'input-reader', target_hash: digest('absent') }] }] }), /not present/);
});

test('unified patch changes only requested text', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'patch', message: 'Patch reader', operations: [{ action: 'patch', id: 'input-reader', expected_hash: s.data.hashes['input-reader'], patch: '@@ -1,2 +1,2 @@\n def read_input():\n-    return {}\n+    return {"ok": True}\n' }] });
  await w.apply('patch'); assert.ok(String((await w.get('input-reader', 'full')).content).includes('True'));
});

test('new standalone documentation requires no artifact', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'article', message: 'New article', operations: [{ action: 'create', node: { id: 'article', kind: 'document', domain: 'tools', repository: 'docs', path: 'knowledge/article.md', title: 'Article', description: 'Standalone article.' }, content: '---\ntype: Guide\n---\n# Article {#article}\nHello.\n' }] });
  await w.apply('article'); assert.equal((await w.get('article')).kind, 'document');
  assert.equal((await w.snapshot()).data.repositories.runtime, s.data.repositories.runtime);
});

test('inventory and related records expose coverage and reasons', async t => {
  const { w } = await fixture(t);
  assert.equal((await w.inventory('runtime')).items.length, 2);
  assert.equal((await w.related('client')).items.find(n => n.id === 'input-guide')?.reasons.includes('shared_target:input-reader'), true);
});

test('file-request CLI exits while runner keeps stdin open', async t => {
  const { w, root } = await fixture(t); const file = path.join(root, 'request.json'); await fs.writeFile(file, '{}');
  const cli = path.resolve('src/cli.ts');
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cli, '--state', w.root, 'call', 'snapshot_get', file], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI waited on stdin')); }, 8000);
    child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err)); });
    // Deliberately leave child.stdin open, like a tool runner.
  });
  assert.equal(JSON.parse(result).snapshot, await w.current());
});

test('concurrent writer lock blocks mutation without touching snapshot', async t => {
  const { w } = await fixture(t); const before = await w.current();
  await w.locked(async () => { await assert.rejects(w.prepare(await replace(w, 'locked')), /locked/); });
  assert.equal(await w.current(), before);
});

test('deleting unreferenced artifact works in bare Git', async t => {
  const { w } = await fixture(t); const s = await w.snapshot();
  await w.prepare({ base_snapshot: s.id, idempotency_key: 'delete-client', message: 'Delete client', operations: [{ action: 'delete', id: 'client', expected_hash: s.data.hashes.client }] });
  await w.apply('delete-client'); await assert.rejects(w.get('client'), /Unknown/);
});

test('discarded change cannot be applied', async t => {
  const { w } = await fixture(t); await w.prepare(await replace(w, 'discard'));
  await w.discard('discard'); await assert.rejects(w.apply('discard'), /not prepared/);
});

test('unknown fields and binary writes are rejected', async t => {
  const { w } = await fixture(t); const request = await replace(w, 'binary', 'input-reader', '\0');
  await assert.rejects(w.prepare(request), /Binary/);
  await assert.rejects(w.prepare({ ...request, typo: true }));
});

test('external source changes are reported without altering published snapshot', async t => {
  const { w, runtime } = await fixture(t); const s = await w.current();
  await fs.writeFile(path.join(runtime, 'src/input.py'), 'print("external")\n'); await git(runtime, ['add', '.']); await git(runtime, ['commit', '-m', 'external']);
  assert.equal((await w.sourceStatus()).repositories.find(r => r.repository === 'runtime')?.differs, true);
  assert.equal(await w.current(), s);
});
