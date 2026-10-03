import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { applyPatch, createTwoFilesPatch } from 'diff';
import YAML from 'yaml';
import { buildBundle, searchConcepts } from '@copperbox/okf-mcp';
import { configSchema, prepareSchema, id as idSchema, revision, type Config, type Node, type Prepare, type Snapshot, type Reason } from './schema.js';
import { atomicJson, readJson, exists, git, gitText, run, fileAt, hasFile, commitFiles } from './git.js';
import { frontmatter, sections, replaceSection, validateDocument } from './markdown.js';

const MAX_BYTES = 1024 * 1024;
export const digest = (s: string | Buffer) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
type Journal = {
  id: string; request_hash: string; base: string; status: 'preparing' | 'prepared' | 'applied' | 'discarded' | 'failed';
  request: Prepare; candidate?: string; result?: string; diffs?: unknown[]; error?: string;
};
function textFile(b: Buffer) {
  if (b.length > MAX_BYTES) throw new Error('Text exceeds 1 MiB limit');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
  if (text.includes('\0')) throw new Error('Binary content is not supported in 0.1');
  return text;
}
function boundedText(s: string) { textFile(Buffer.from(s)); return s; }

export class Workspace {
  readonly root: string;
  readonly control: string;
  constructor(root: string) { this.root = path.resolve(root); this.control = path.join(this.root, 'control.git'); }
  repo(name: string) { idSchema.parse(name); return path.join(this.root, 'repos', name + '.git'); }
  journal(name: string) { idSchema.parse(name); return path.join(this.root, 'changes', name + '.json'); }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = path.join(this.root, 'write.lock');
    let lock;
    try { lock = await fs.open(p, 'wx', 0o600); }
    catch (e: any) { if (e.code === 'EEXIST') throw new Error('Workspace is locked. If a process crashed, see recovery instructions.'); throw e; }
    try { await lock.writeFile(JSON.stringify({ pid: process.pid, at: now() })); return await fn(); }
    finally { await lock.close(); await fs.unlink(p); }
  }
  async initializeCatalog(s: Snapshot, cfg: Config): Promise<void> {}
  async enrich(base: Snapshot, next: Snapshot, changed: string[], original?: Map<string,string>, content?: Map<string,string>): Promise<void> {}
  async afterReviews(s: Snapshot, ids: string[]): Promise<void> {}
  async current() { return gitText(this.control, ['rev-parse', '--verify', 'refs/heads/current']); }
  async snapshot(ref?: string): Promise<{ id: string; data: Snapshot }> {
    const sha = ref ? revision.parse(ref) : await this.current();
    return { id: sha, data: JSON.parse((await fileAt(this.control, sha, 'snapshot.json')).toString()) };
  }
  async saveSnapshot(s: Snapshot) {
    return commitFiles(this.control, s.parent, new Map([['snapshot.json', JSON.stringify(s, null, 2) + '\n']]), `Snapshot ${s.change_id}`);
  }
  async init(input: unknown, baseDir = process.cwd()) {
    const cfg = configSchema.parse(input);
    if (await exists(this.root) && (await fs.readdir(this.root)).length) throw new Error('State directory must be empty');
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    return this.locked(async () => {
      await fs.mkdir(path.join(this.root, 'repos'));
      await fs.mkdir(path.join(this.root, 'changes'));
      await run('git', ['init', '--bare', this.control]);
      const repositories: Record<string, string> = {};
      const sourceConfig: Record<string, { path: string; ref: string; imported_commit: string }> = {};
      for (const [name, spec] of Object.entries(cfg.repositories)) {
        const source = await fs.realpath(path.resolve(baseDir, spec.path));
        const commit = await gitText(source, ['rev-parse', '--verify', '--end-of-options', `${spec.ref}^{commit}`]);
        await run('git', ['clone', '--bare', '--no-hardlinks', '--', source, this.repo(name)]);
        await git(this.repo(name), ['config', 'gc.auto', '0']);
        repositories[name] = commit; sourceConfig[name] = { path: source, ref: spec.ref, imported_commit: commit };
      }
      const snap: Snapshot = { schema_version: 1, parent: null, change_id: 'init', created_at: now(),
        repositories, nodes: cfg.nodes, domains: cfg.domains, hashes: {}, reviews: {}, review_history: [], based_on: {} };
      await this.initializeCatalog(snap, cfg);
      const contents = await this.contents(snap);
      await this.validateState(snap, contents);
      for (const n of snap.nodes) snap.hashes[n.id] = digest(contents.get(n.id)!);
      // Imported documentation is linked to imported bytes, but not declared human-verified.
      for (const n of snap.nodes) {
        snap.based_on[n.id] = Object.fromEntries(n.relations.filter(r => r.type === 'documents').map(r => [r.target, snap.hashes[r.target]]));
      }
      const sha = await this.saveSnapshot(snap);
      await this.retain(snap, sha);
      await git(this.control, ['update-ref', 'refs/heads/current', sha, '0'.repeat(40)]);
      await atomicJson(path.join(this.root, 'sources.json'), sourceConfig);
      return { snapshot: sha, nodes: snap.nodes.length, repositories: snap.repositories };
    });
  }
  async retain(s: Snapshot, candidate: string) {
    for (const [name, commit] of Object.entries(s.repositories))
      await git(this.repo(name), ['update-ref', `refs/heads/snapshots/${s.change_id}`, commit]);
    await git(this.control, ['update-ref', `refs/heads/changes/${s.change_id}`, candidate]);
  }
  async contents(s: Snapshot) {
    const result = new Map<string, string>();
    for (const n of s.nodes) {
      if (!s.repositories[n.repository]) throw new Error(`Unknown repository: ${n.repository}`);
      result.set(n.id, textFile(await fileAt(this.repo(n.repository), s.repositories[n.repository], n.path)));
    }
    return result;
  }
  async validateState(s: Snapshot, content: Map<string, string>) {
    const ids = new Set<string>(), paths = new Set<string>();
    const domains = new Set(s.domains.map(d => d.id));
    if (domains.size !== s.domains.length) throw new Error('Duplicate domain ID');
    for (const n of s.nodes) {
      if (ids.has(n.id)) throw new Error(`Duplicate ID: ${n.id}`);
      ids.add(n.id);
      if (!domains.has(n.domain)) throw new Error(`Unknown domain: ${n.domain}`);
      if (!s.repositories[n.repository]) throw new Error(`Unknown repository: ${n.repository}`);
      const p = `${n.repository}:${n.path.toLowerCase()}`;
      if (paths.has(p)) throw new Error(`Duplicate/case-colliding path: ${p}`);
      paths.add(p);
      boundedText(content.get(n.id)!);
      if (n.kind === 'document') {
        if (!n.path.endsWith('.md') || ['index.md', 'log.md'].includes(path.posix.basename(n.path)) || n.path.split('/').some(p => p.startsWith('.')))
          throw new Error('Document must be a non-reserved visible .md path');
        validateDocument(content.get(n.id)!);
      }
    }
    for (const n of s.nodes) for (const r of n.relations) {
      const target = s.nodes.find(x => x.id === r.target);
      if (!target) throw new Error(`Dangling relation ${n.id} -> ${r.target}`);
      let targetContent = content.get(target.id)!;
      if (r.target_hash && r.target_hash !== digest(content.get(target.id)!)) {
        let parent = s.parent, known = false;
        while (parent) {
          const historical = (await this.snapshot(parent)).data;
          if (historical.hashes[target.id] === r.target_hash) {
            const oldTarget = historical.nodes.find(n => n.id === target.id)!;
            targetContent = textFile(await fileAt(this.repo(oldTarget.repository), historical.repositories[oldTarget.repository], oldTarget.path));
            known = true; break;
          }
          parent = historical.parent;
        }
        if (!known) throw new Error(`Pinned target hash is not present in snapshot history: ${r.target}`);
      }
      if (r.section && (target.kind !== 'document' || !sections(targetContent).some(x => x.id === r.section)))
        throw new Error(`Missing target section ${r.target}#${r.section}`);
      if (r.source_section && (n.kind !== 'document' || !sections(content.get(n.id)!).some(x => x.id === r.source_section)))
        throw new Error(`Missing source section ${n.id}#${r.source_section}`);
    }
  }
  async prepare(input: unknown) {
    const request = prepareSchema.parse(input);
    if (Buffer.byteLength(JSON.stringify(request)) > 8 * MAX_BYTES) throw new Error('Changeset exceeds 8 MiB limit');
    if (request.idempotency_key === 'init') throw new Error('init is a reserved change ID');
    return this.locked(async () => {
      const p = this.journal(request.idempotency_key);
      const requestHash = digest(JSON.stringify(request));
      if (await exists(p)) {
        const old = await readJson<Journal>(p);
        if (old.request_hash !== requestHash) throw new Error('Idempotency key already used for another request');
        if (old.status !== 'preparing' && old.status !== 'failed') return old;
      }
      if (await this.current() !== request.base_snapshot) throw new Error('Snapshot conflict; read current state and prepare again');
      const journal: Journal = { id: request.idempotency_key, request_hash: requestHash, base: request.base_snapshot, request, status: 'preparing' };
      await atomicJson(p, journal);
      try {
        const { data: base } = await this.snapshot(request.base_snapshot);
        const next = structuredClone(base);
        next.parent = request.base_snapshot; next.change_id = request.idempotency_key; next.created_at = now();
        const original = await this.contents(base), content = new Map(original);
        const seen = new Set<string>();
        const reviewOps: Extract<Prepare['operations'][number], { action: 'review' }>[] = [];
        for (const op of request.operations) {
          if (op.action === 'review') { reviewOps.push(op); continue; }
          const targetId = op.action === 'create' ? op.node.id : op.id;
          if (seen.has(targetId)) throw new Error('One content/metadata operation per node per changeset');
          seen.add(targetId);
          let n = next.nodes.find(n => n.id === targetId);
          if (op.action === 'create') {
            if (n) throw new Error(`ID already exists: ${targetId}`);
            if (!next.repositories[op.node.repository]) throw new Error('Unknown repository');
            if (await hasFile(this.repo(op.node.repository), base.repositories[op.node.repository], op.node.path)) throw new Error('Path already exists in Git');
            next.nodes.push(structuredClone(op.node)); content.set(targetId, boundedText(op.content)); continue;
          }
          if (!n) throw new Error(`Unknown node: ${targetId}`);
          if (base.hashes[targetId] !== op.expected_hash) throw new Error(`Content conflict: ${targetId}`);
          if (op.action === 'replace') content.set(n.id, boundedText(op.content));
          if (op.action === 'patch') {
            const updated = applyPatch(content.get(n.id)!, op.patch, { fuzzFactor: 0 });
            if (updated === false) throw new Error(`Patch does not apply: ${n.id}`);
            content.set(n.id, boundedText(updated));
          }
          if (op.action === 'replace_section') {
            if (n.kind !== 'document') throw new Error('Section replacement requires a document');
            content.set(n.id, replaceSection(content.get(n.id)!, op.section_id, op.content));
          }
          if (op.action === 'metadata') {
            for (const k of ['title', 'description', 'version', 'relations', 'card'] as const)
              if (op[k] !== undefined) (n as any)[k] = structuredClone(op[k]);
          }
          if (op.action === 'move') {
            if (op.path !== n.path && await hasFile(this.repo(n.repository), base.repositories[n.repository], op.path)) throw new Error('Move target already exists');
            n.path = op.path;
          }
          if (op.action === 'delete') { next.nodes = next.nodes.filter(x => x.id !== n!.id); content.delete(n.id); delete next.reviews[n.id]; delete next.based_on[n.id]; }
        }
        await this.validateState(next, content);
        next.hashes = Object.fromEntries(next.nodes.map(n => [n.id, digest(content.get(n.id)!)]));
        const changed = [...new Set([...base.nodes, ...next.nodes].map(n => n.id))].filter(id =>
          base.hashes[id] !== next.hashes[id] || JSON.stringify(base.nodes.find(n => n.id === id)) !== JSON.stringify(next.nodes.find(n => n.id === id)));
        this.markDependents(base, next, changed, original, content);
        await this.enrich(base, next, changed, original, content);
        // Changing a dependency declaration itself also requires an explicit review.
        for (const n of next.nodes) {
          const prev = base.nodes.find(x => x.id === n.id);
          if (JSON.stringify(prev?.relations ?? []) !== JSON.stringify(n.relations) && n.relations.length) {
            (next.reviews[n.id] ??= []).push({ id: randomUUID(), source: n.id, before: base.hashes[n.id] ?? null,
              after: next.hashes[n.id], via: [n.id], change: next.change_id });
          }
        }
        for (const op of reviewOps) {
          if (!next.hashes[op.id] || base.hashes[op.id] !== op.expected_hash) throw new Error('Review target conflict');
          const pending = next.reviews[op.id] ?? [];
          if (op.reason_ids.some(id => !pending.some(r => r.id === id))) throw new Error('Review reason missing or already resolved');
          // New causes from this changeset cannot be silently cleared by an older review request.
          if (pending.some(r => op.reason_ids.includes(r.id) && r.change === next.change_id)) throw new Error('Review new causes in a subsequent changeset');
          next.reviews[op.id] = pending.filter(r => !op.reason_ids.includes(r.id));
          next.review_history.push({ target: op.id, reason_ids: op.reason_ids, actor: op.actor, evidence: op.evidence, at: now(), change: next.change_id });
          if (!next.reviews[op.id].length) {
            const n = next.nodes.find(n => n.id === op.id)!;
            next.based_on[op.id] = Object.fromEntries(n.relations.filter(r => r.type === 'documents').map(r => [r.target, r.target_hash ?? next.hashes[r.target]]));
          }
        }
        await this.afterReviews(next, reviewOps.map(op => op.id));
        const diffs: unknown[] = [];
        for (const name of Object.keys(base.repositories)) {
          const edits = new Map<string, string | null>();
          const modes = new Map<string, string>();
          for (const n of base.nodes.filter(n => n.repository === name)) {
            const after = next.nodes.find(x => x.id === n.id);
            if (!after || after.path !== n.path) edits.set(n.path, null);
          }
          for (const n of next.nodes.filter(n => n.repository === name)) {
            const before = base.nodes.find(x => x.id === n.id);
            if (!before || before.path !== n.path || base.hashes[n.id] !== next.hashes[n.id]) edits.set(n.path, content.get(n.id)!);
            if (before && before.path !== n.path) {
              const entry = (await git(this.repo(name), ['ls-tree', '-z', base.repositories[name], '--', before.path])).toString();
              if (entry.startsWith('100755')) modes.set(n.path, '100755');
            }
          }
          if (edits.size) next.repositories[name] = await commitFiles(this.repo(name), base.repositories[name], edits, request.message, modes);
        }
        for (const nodeId of changed) {
          const before = base.nodes.find(n => n.id === nodeId), after = next.nodes.find(n => n.id === nodeId);
          const diff = createTwoFilesPatch(before?.path ?? '/dev/null', after?.path ?? '/dev/null', original.get(nodeId) ?? '', content.get(nodeId) ?? '');
          diffs.push({ id: nodeId, before, after, diff: diff.slice(0, 30000), truncated: diff.length > 30000 });
        }
        journal.candidate = await this.saveSnapshot(next);
        await this.retain(next, journal.candidate);
        journal.diffs = diffs; journal.status = 'prepared';
        await atomicJson(p, journal);
        return { ...journal, review_required: next.reviews };
      } catch (e: any) {
        journal.status = 'failed'; journal.error = e.message; await atomicJson(p, journal); throw e;
      }
    });
  }
  markDependents(base: Snapshot, next: Snapshot, changed: string[], oldContent: Map<string, string>, newContent: Map<string, string>) {
    // Union preserves dependencies removed in this change, so removals do not hide impacts.
    const edges = [...base.nodes, ...next.nodes].flatMap(n => n.relations.map(r => ({ from: n.id, ...r })))
      .filter(r => ['depends_on', 'documents', 'implements'].includes(r.type));
    for (const source of changed) {
      const queue = [{ target: source, via: [source], depth: 0 }];
      const visited = new Set<string>([source]);
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i];
        for (const edge of edges.filter(e => e.target === q.target)) {
          if (visited.has(edge.from) || !next.nodes.some(n => n.id === edge.from)) continue;
          // A pinned dependency on old bytes is unchanged by a new default version.
          if (edge.target_hash && edge.target_hash !== next.hashes[edge.target]) continue;
          if (q.depth === 0 && edge.section && oldContent.has(source) && newContent.has(source)) {
            const before = sections(oldContent.get(source)!).find(s => s.id === edge.section);
            const after = sections(newContent.get(source)!).find(s => s.id === edge.section);
            if (before && after && oldContent.get(source)!.slice(before.start, before.end) === newContent.get(source)!.slice(after.start, after.end)) continue;
          }
          visited.add(edge.from);
          const via = [...q.via, edge.from];
          const reason: Reason = { id: randomUUID(), source, before: base.hashes[source] ?? null, after: next.hashes[source] ?? null, via, change: next.change_id };
          (next.reviews[edge.from] ??= []).push(reason);
          // Full transitive closure; visited prevents cycles and duplicate paths per source.
          queue.push({ target: edge.from, via, depth: q.depth + 1 });
        }
      }
    }
  }
  async apply(changeId: string) {
    return this.locked(async () => {
      const p = this.journal(changeId), j = await readJson<Journal>(p);
      if (j.status === 'discarded' || !j.candidate) throw new Error('Change is not prepared');
      const current = await this.current();
      // Reconcile a crash after ref publication but before journal update, even after later changes.
      if (await this.isPublished(j.candidate, current)) {
        j.status = 'applied'; j.result = j.candidate; await atomicJson(p, j); return { change_id: j.id, snapshot: j.candidate, status: j.status };
      }
      if (j.status !== 'prepared') throw new Error('Change is not prepared');
      if (current !== j.base) throw new Error('Snapshot conflict; prepare a new change');
      // All repository commits already exist. One CAS publishes the complete snapshot.
      await git(this.control, ['update-ref', 'refs/heads/current', j.candidate, j.base]);
      j.status = 'applied'; j.result = j.candidate; await atomicJson(p, j);
      return { change_id: j.id, snapshot: j.candidate, status: j.status };
    });
  }
  async isPublished(candidate: string, current: string) {
    try { await git(this.control, ['merge-base', '--is-ancestor', candidate, current]); return true; } catch { return false; }
  }
  async changeGet(changeId: string) {
    const j = await readJson<Journal>(this.journal(changeId));
    if (j.candidate && await this.isPublished(j.candidate, await this.current())) j.status = 'applied';
    return j;
  }
  async discard(changeId: string) {
    return this.locked(async () => {
      const j = await this.changeGet(changeId);
      if (j.status === 'applied') throw new Error('Cannot discard an applied change');
      j.status = 'discarded'; await atomicJson(this.journal(changeId), j); return { change_id: changeId, status: j.status };
    });
  }
  async get(nodeId: string, view: 'brief' | 'summary' | 'outline' | 'full' | 'sections' = 'brief', sectionIds: string[] = [], snapshot?: string, atHash?: string): Promise<Record<string, unknown>> {
    const { id, data: s } = await this.snapshot(snapshot);
    if (atHash && s.hashes[nodeId] !== atHash) {
      if (!s.parent) throw new Error('Requested content hash is absent from snapshot history');
      return this.get(nodeId, view, sectionIds, s.parent, atHash);
    }
    const n = s.nodes.find(n => n.id === nodeId); if (!n) throw new Error('Unknown node');
    const card: Record<string, unknown> = { ...n, snapshot: id, content_hash: s.hashes[n.id], revision: s.repositories[n.repository],
      review_required: s.reviews[n.id] ?? [], based_on: s.based_on[n.id] ?? {} };
    if (view === 'brief') return card;
    const text = textFile(await fileAt(this.repo(n.repository), s.repositories[n.repository], n.path));
    if (view === 'full') return { ...card, content: text };
    if (n.kind !== 'document') throw new Error('Artifacts support brief or full views');
    if (view === 'summary') return { ...card, summary: frontmatter(text).metadata.summary ?? n.description };
    const outline = sections(text);
    if (view === 'outline') return { ...card, sections: outline.map(x => ({ id: x.id, title: x.title, level: x.level, characters: x.end - x.start })) };
    if (!sectionIds.length) throw new Error('sections view requires section_ids');
    const selected = sectionIds.map(id => { const section = outline.find(x => x.id === id); if (!section) throw new Error(`Unknown section: ${id}`); return section; });
    // Full document remains available for footnotes/reference definitions outside selected ranges.
    return { ...card, sections: selected.map(x => ({ id: x.id, content: text.slice(x.start, x.end) })), context_note: 'Reference definitions and footnotes may be outside selected sections; request full if needed.' };
  }
  async list(options: { domain?: string; kind?: string; needs_review?: boolean; offset?: number; limit?: number; snapshot?: string } = {}) {
    const { id, data: s } = await this.snapshot(options.snapshot);
    const all = s.nodes.filter(n => (!options.domain || n.domain === options.domain) && (!options.kind || n.kind === options.kind) &&
      (options.needs_review === undefined || Boolean(s.reviews[n.id]?.length) === options.needs_review));
    const offset = Math.max(0, options.offset ?? 0), limit = Math.min(100, Math.max(1, options.limit ?? 20));
    return { snapshot: id, total: all.length, offset, items: all.slice(offset, offset + limit).map(n => ({ ...n, content_hash: s.hashes[n.id], needs_review: Boolean(s.reviews[n.id]?.length) })) };
  }
  async search(query: string, domain?: string, limit = 20, snapshot?: string, offset = 0) {
    const { id, data: s } = await this.snapshot(snapshot), contents = await this.contents(s);
    const bundles = s.domains.filter(d => !domain || d.id === domain).map(d => buildBundle(d.id, '/', s.nodes.filter(n => n.domain === d.id && n.kind === 'document').map(n => {
      const parsed = frontmatter(contents.get(n.id)!);
      return { path: `${n.id}.md`, source: '---\n' + YAML.stringify({ ...parsed.metadata, title: n.title, description: n.description }) + '---\n' + parsed.body };
    }), { readOnly: true }));
    const result = searchConcepts(bundles, { query, limit: Math.min(100, Math.max(1, limit)), offset: Math.max(0, offset) });
    return { snapshot: id, ...result, hits: result.hits.map(h => ({ ...h, content_hash: s.hashes[h.id], needs_review: Boolean(s.reviews[h.id]?.length) })) };
  }
  async graph(nodeId: string, direction: 'dependencies' | 'dependents' = 'dependencies', depth = 1, snapshot?: string) {
    const { id, data: s } = await this.snapshot(snapshot);
    if (!s.nodes.some(n => n.id === nodeId)) throw new Error('Unknown node');
    const edges = s.nodes.flatMap(n => n.relations.map(r => ({ from: n.id, ...r })));
    const seen = new Set([nodeId]), queue = [{ id: nodeId, depth: 0 }], result: unknown[] = [];
    let truncated = false;
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i]; if (q.depth >= Math.min(8, Math.max(1, depth))) continue;
      for (const e of edges.filter(e => (direction === 'dependencies' ? e.from : e.target) === q.id)) {
        if (result.length >= 500) { truncated = true; break; }
        result.push(e); const other = direction === 'dependencies' ? e.target : e.from;
        if (!seen.has(other)) { seen.add(other); queue.push({ id: other, depth: q.depth + 1 }); }
      }
    }
    return { snapshot: id, domains: s.domains.map(d => d.id), edges: result, truncated };
  }
  async inventory(repository: string, offset = 0, limit = 50, snapshot?: string) {
    const { id, data } = await this.snapshot(snapshot);
    if (!data.repositories[repository]) throw new Error('Unknown repository');
    const entries = (await git(this.repo(repository), ['ls-tree', '-rz', data.repositories[repository]])).toString().split('\0').filter(Boolean);
    const items = entries.slice(offset, offset + limit).map(entry => {
      const tab = entry.indexOf('\t'), [mode, type, oid] = entry.slice(0, tab).split(' '), file = entry.slice(tab + 1);
      const node = data.nodes.find(n => n.repository === repository && n.path === file);
      return { path: file, mode, type, git_oid: oid, registered_id: node?.id ?? null, kind: node?.kind ?? null };
    });
    return { snapshot: id, repository, total: entries.length, offset, items };
  }
  async related(nodeId: string, limit = 20, snapshot?: string) {
    const { id, data } = await this.snapshot(snapshot);
    const node = data.nodes.find(n => n.id === nodeId); if (!node) throw new Error('Unknown node');
    const targets = new Set(node.relations.map(r => r.target));
    const items = data.nodes.filter(n => n.id !== nodeId).map(n => {
      const reasons: string[] = [];
      if (targets.has(n.id)) reasons.push('outgoing_relation');
      if (n.relations.some(r => r.target === nodeId)) reasons.push('incoming_relation');
      for (const r of n.relations) {
        if (targets.has(r.target)) reasons.push(`shared_target:${r.target}`);
      }
      if (data.nodes.some(m => targets.has(m.id) && m.relations.some(e => e.target === n.id))) reasons.push('two_hop_outgoing');
      return { id: n.id, title: n.title, domain: n.domain, reasons: [...new Set(reasons)] };
    }).filter(n => n.reasons.length).sort((a, b) => b.reasons.length - a.reasons.length || a.id.localeCompare(b.id));
    return { snapshot: id, method: 'explicit graph and shared targets; no semantic similarity', total: items.length, items: items.slice(0, limit) };
  }
  async validate(snapshot?: string) {
    const { id, data } = await this.snapshot(snapshot);
    const content = await this.contents(data); await this.validateState(data, content);
    for (const n of data.nodes) if (digest(content.get(n.id)!) !== data.hashes[n.id]) throw new Error(`Hash mismatch: ${n.id}`);
    return { snapshot: id, valid: true, nodes: data.nodes.length, review_required: Object.keys(data.reviews).filter(k => data.reviews[k].length) };
  }
  async sourceStatus() {
    const source = await readJson<Record<string, { path: string; ref: string; imported_commit: string }>>(path.join(this.root, 'sources.json'));
    const { id, data } = await this.snapshot(); const results = [];
    for (const [name, spec] of Object.entries(source)) {
      const sourceCommit = await gitText(spec.path, ['rev-parse', '--verify', '--end-of-options', `${spec.ref}^{commit}`]);
      results.push({ repository: name, source_commit: sourceCommit, snapshot_commit: data.repositories[name], differs: sourceCommit !== data.repositories[name], changed_since_import: sourceCommit !== spec.imported_commit });
    }
    return { snapshot: id, repositories: results };
  }
  async exportSnapshot(destination: string, snapshot?: string) {
    const target = path.resolve(destination);
    if (await exists(target)) throw new Error('Export destination must not exist');
    const { id, data } = await this.snapshot(snapshot);
    await fs.mkdir(target, { recursive: true });
    for (const [name, commit] of Object.entries(data.repositories)) {
      const dest = path.join(target, name);
      await run('git', ['clone', '--no-hardlinks', '--no-checkout', '--', this.repo(name), dest]);
      await git(dest, ['checkout', '--detach', commit]);
    }
    await fs.writeFile(path.join(target, 'snapshot.json'), JSON.stringify({ snapshot: id, ...data }, null, 2) + '\n');
    return { snapshot: id, destination: target };
  }
}
