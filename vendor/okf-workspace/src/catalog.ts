import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Workspace, digest } from './workspace.js';
import type { Snapshot, Config, Node } from './schema.js';
import { atomicJson, exists, readJson, git, fileAt } from './git.js';
import { sections, frontmatter } from './markdown.js';
import { validateManifest, type Manifest } from './manifest.js';
import type { Catalog, Mapping, Analysis, Task } from './catalog-model.js';

const fileKey = (repo: string, p: string) => `file:${repo}:${p}`;
const stable = (v: any): string => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map(x => JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(stable(v[k]))])) : v);
const keyOf = (v: any) => digest(stable(v)).slice(7, 31);
const under = (p: string, prefix: string) => !prefix || p === prefix || p.startsWith(prefix + '/');
export class CatalogWorkspace extends Workspace {
  makeCatalog(s: Snapshot, cfg?: Config): Catalog {
    const coverage = cfg?.coverage ?? Object.keys(s.repositories).flatMap(repository => {
      const domains = [...new Set(s.nodes.filter(n => n.repository === repository).map(n => n.domain))];
      return domains.length === 1 ? [{ repository, prefix: '', domain: domains[0], exclusions: [] }] : [];
    });
    const cat: Catalog = { version: 2, coverage, analyses: {}, migration: { unresolved: [] }, notices: [] };
    for (const artifact of s.nodes.filter(n => n.kind === 'artifact')) {
      const docs = s.nodes.filter(n => n.kind === 'document' && n.relations.some(r => r.type === 'documents' && r.target === artifact.id));
      if (docs.length === 1 && docs[0].relations.filter(r => r.type === 'documents').length === 1) {
        docs[0].card ??= { mode: 'full', subject: { repository: artifact.repository, path: artifact.path, artifact_id: artifact.id }, references: [] };
      } else if (docs.length > 1) cat.migration.unresolved.push(artifact.id);
    }
    return cat;
  }
  override async initializeCatalog(s: Snapshot, cfg: Config) {
    s.catalog = this.makeCatalog(s, cfg);
    for (const scope of s.catalog.coverage) {
      if (!s.repositories[scope.repository] || !s.domains.some(d => d.id === scope.domain)) throw new Error('Unknown coverage repository/domain');
    }
  }
  requireV2(s: Snapshot): Catalog { if (!s.catalog) throw new Error('Migration required: use migration_prepare then changes_apply'); return s.catalog; }
  subject(s: Snapshot, doc: Node) {
    const c = doc.card; if (!c) return undefined;
    const artifact = c.subject.artifact_id ? s.nodes.find(n => n.id === c.subject.artifact_id) : undefined;
    return artifact ? { repository: artifact.repository, path: artifact.path } : c.subject;
  }
  async extension(base: string, key: string, request: unknown, mutate: (s: Snapshot, previous: Snapshot) => Promise<unknown>) {
    return this.locked(async () => {
      const jp = this.journal(key), hash = digest(stable(request));
      if (key === 'init') throw new Error('Reserved change ID');
      if (await exists(jp)) {
        const old = await readJson<any>(jp);
        if (old.request_hash !== hash) throw new Error('Idempotency key reused with different payload');
        if (!['failed', 'preparing'].includes(old.status)) return old;
      }
      if (await this.current() !== base) throw new Error('Snapshot conflict');
      const j: any = { id: key, base, request_hash: hash, request, status: 'preparing' };
      await atomicJson(jp, j);
      try {
        const previous = (await this.snapshot(base)).data, next = structuredClone(previous);
        next.parent = base; next.change_id = key; next.created_at = new Date().toISOString();
        j.summary = await mutate(next, previous);
        await this.validateState(next, await this.contents(next));
        j.candidate = await this.saveSnapshot(next); await this.retain(next, j.candidate);
        j.status = 'prepared'; await atomicJson(jp, j); return j;
      } catch (e: any) { j.status = 'failed'; j.error = e.message; await atomicJson(jp, j); throw e; }
    });
  }
  async migrate(a: { base_snapshot: string; idempotency_key: string }) {
    return this.extension(a.base_snapshot, a.idempotency_key, a, async s => {
      if (s.catalog) throw new Error('Already migrated');
      s.catalog = this.makeCatalog(s);
      return { migrated: true, unresolved: s.catalog.migration.unresolved, card_assignments: s.nodes.filter(n => n.card).map(n => n.id), legacy_relations_preserved: true };
    });
  }
  mappedFile(m: Manifest, mapping: Mapping, nodeId: string): { repository: string; path: string } | undefined {
    const n = m.nodes.find(n => n.id === nodeId);
    if (n?.kind === 'symbol') return this.mappedFile(m, mapping, n.file);
    if (n?.kind !== 'file' || !mapping[n.source]) return undefined;
    const mount = mapping[n.source]; return { repository: mount.repository, path: path.posix.join(mount.prefix, n.path) };
  }
  projected(s: Snapshot, analysisIds?: string[]) {
    const result: { dependent: string; dependency: string; relation: string; origin: string; section?: string }[] = [];
    for (const a of Object.values(s.catalog?.analyses ?? {})) {
      if (analysisIds && !analysisIds.includes(a.id)) continue;
      for (const e of a.manifest.edges) {
        const x = this.mappedFile(a.manifest, a.mapping, e.dependent), y = this.mappedFile(a.manifest, a.mapping, e.dependency);
        if (x && y && fileKey(x.repository, x.path) !== fileKey(y.repository, y.path))
          result.push({ dependent: fileKey(x.repository, x.path), dependency: fileKey(y.repository, y.path), relation: e.relation, origin: a.id });
      }
    }
    for (const n of s.nodes) for (const r of n.relations.filter(r => ['depends_on','implements'].includes(r.type))) {
      const t = s.nodes.find(x => x.id === r.target);
      if (t && (!r.target_hash || r.target_hash === s.hashes[t.id])) result.push({ dependent: fileKey(n.repository,n.path), dependency: fileKey(t.repository,t.path), relation:r.type, origin:'manual', section:r.section });
    }
    return result;
  }
  impact(base: Snapshot, next: Snapshot, seeds: string[], origin: string, original?: Map<string,string>, content?: Map<string,string>) {
    const edges = [...this.projected(base), ...this.projected(next)];
    for(const n of next.nodes) {
      const subject=this.subject(next,n);
      if(subject)edges.push({dependent:fileKey(n.repository,n.path),dependency:fileKey(subject.repository,subject.path),relation:'documents',origin:'manual'});
    }
    // Delegated card -> main documentation; changes to the latter require review of the card.
    for (const n of next.nodes) for (const r of n.card?.references ?? []) {
      const target = next.nodes.find(t => t.id === r.document);
      if (target) edges.push({ dependent: fileKey(n.repository,n.path), dependency: fileKey(target.repository,target.path), relation:'delegates', origin:'manual',section:r.section });
    }
    for (const seed of [...new Set(seeds)]) {
      const seen = new Set([seed]), queue = [{ key: seed, via: [seed] }];
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i];
        for (const n of next.nodes) {
          const own = fileKey(n.repository,n.path), subject = this.subject(next,n);
          if (own !== q.key && (!subject || fileKey(subject.repository,subject.path) !== q.key)) continue;
          if ((next.reviews[n.id] ?? []).some(r => r.change === next.change_id && r.source === seed)) continue;
          (next.reviews[n.id] ??= []).push({ id: randomUUID(), source: seed, before: null, after: null, via: [...q.via, n.id, origin], change: next.change_id });
        }
        for (const e of edges.filter(e => e.dependency === q.key)) if (!seen.has(e.dependent)) {
          if(e.section&&q.key===seed&&original&&content){
            const n=next.nodes.find(n=>fileKey(n.repository,n.path)===seed);
            if(n&&original.has(n.id)&&content.has(n.id)){
              const a=original.get(n.id)!,b=content.get(n.id)!;
              const x=sections(a).find(s=>s.id===e.section),y=sections(b).find(s=>s.id===e.section);
              if(x&&y&&a.slice(x.start,x.end)===b.slice(y.start,y.end))continue;
            }
          }
          seen.add(e.dependent); queue.push({ key:e.dependent, via:[...q.via,e.dependent] });
        }
      }
    }
  }
  async freshness(s: Snapshot, a: Analysis) {
    const mismatch: string[] = [];
    for (const n of a.manifest.nodes) if (n.kind === 'file') {
      const location = this.mappedFile(a.manifest,a.mapping,n.id)!;
      try { if (digest(await fileAt(this.repo(location.repository),s.repositories[location.repository],location.path)) !== n.content_hash) mismatch.push(n.id); }
      catch { mismatch.push(n.id); }
    }
    for(const mount of Object.values(a.mapping)) {
      const before=a.repositories[mount.repository],after=s.repositories[mount.repository];
      if(before&&before!==after) {
        const added=(await git(this.repo(mount.repository),['diff','--name-only','--diff-filter=A','-z',before,after])).toString().split('\0').filter(Boolean);
        for(const p of added)if(under(p,mount.prefix))mismatch.push('new:'+p);
      }
    }
    a.mismatch = mismatch; a.fresh = mismatch.length === 0;
  }
  override async enrich(base: Snapshot, next: Snapshot, changed: string[], original?:Map<string,string>, content?:Map<string,string>) {
    const cat = this.requireV2(next);
    for (const a of Object.values(cat.analyses)) await this.freshness(next,a);
    // Repository commits are assembled later; compare staged registered bytes as well.
    for (const a of Object.values(cat.analyses)) for (const f of a.manifest.nodes) if (f.kind === 'file') {
      const loc = this.mappedFile(a.manifest,a.mapping,f.id)!;
      const n = next.nodes.find(n => n.repository === loc.repository && n.path === loc.path);
      const old = base.nodes.find(n => n.repository === loc.repository && n.path === loc.path);
      if ((n && next.hashes[n.id] !== f.content_hash) || (old && !n)) { a.fresh = false; if (!a.mismatch.includes(f.id)) a.mismatch.push(f.id); }
    }
    const seeds: string[] = [];
    for (const k of changed) {
      const old = base.nodes.find(n => n.id === k), n = next.nodes.find(n => n.id === k);
      const bytesChanged = base.hashes[k] !== next.hashes[k];
      if (bytesChanged) {
        if (old) seeds.push(fileKey(old.repository,old.path));
        if (n) seeds.push(fileKey(n.repository,n.path));
      }
      if (old && n && old.path !== n.path && !bytesChanged) cat.notices.push({ action:'repair_reference', subject:fileKey(n.repository,n.path), reason:'path_changed', change:next.change_id });
      if (old && !n) cat.notices.push({ action:'retire', subject:fileKey(old.repository,old.path), reason:'file_deleted', change:next.change_id });
    }
    this.impact(base,next,seeds,'content_change',original,content);
  }
  async importDependencies(a: { base_snapshot:string; idempotency_key:string; manifest:unknown; mapping:Mapping }) {
    const m = validateManifest(a.manifest);
    if (Buffer.byteLength(JSON.stringify(m)) > 16*1024*1024) throw new Error('Manifest exceeds 16 MiB');
    return this.extension(a.base_snapshot,a.idempotency_key,{...a,manifest:m},async (s,base) => {
      const cat = this.requireV2(s);
      for (const root of m.sources) if (!a.mapping[root.id] || !s.repositories[a.mapping[root.id].repository]) throw new Error('Every source root requires an explicit repository mapping');
      if (Object.keys(a.mapping).some(k => !m.sources.some(r => r.id === k))) throw new Error('Unknown mapped source');
      const registered:string[]=[];
      for(const f of m.nodes)if(f.kind==='file') {
        const loc=this.mappedFile(m,a.mapping,f.id)!;
        if(s.nodes.some(n=>n.repository===loc.repository&&n.path===loc.path))continue;
        const scopes=cat.coverage.filter(c=>c.repository===loc.repository&&under(loc.path,c.prefix)).sort((x,y)=>y.prefix.length-x.prefix.length);
        const scope=scopes[0];
        if(!scope||scopes.some(c=>c.prefix.length===scope.prefix.length&&c.domain!==scope.domain)||scope.exclusions.some(e=>under(loc.path,e.prefix)))continue;
        const bytes=await fileAt(this.repo(loc.repository),s.repositories[loc.repository],loc.path);
        if(bytes.length>1024*1024||bytes.includes(0))continue;
        try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{continue;}
        const nodeId='artifact-'+keyOf(loc);
        if(s.nodes.some(n=>n.id===nodeId))throw new Error('Generated artifact ID collision');
        s.nodes.push({id:nodeId,kind:'artifact',domain:scope.domain,repository:loc.repository,path:loc.path,title:path.posix.basename(loc.path),description:'File observed by '+m.producer.name,relations:[]});
        s.hashes[nodeId]=f.content_hash;registered.push(nodeId);
      }
      const analysisId = 'analysis-' + keyOf({ producer:m.producer.name, analyzer:m.producer.analyzer, scope:m.scope });
      const old = cat.analyses[analysisId];
      if (old && stable(old.mapping) !== stable(a.mapping)) throw new Error('Mapping changed for existing analysis; explicit remapping is required');
      const imported: Analysis = { id:analysisId, manifest:m, mapping:a.mapping, repositories:{...s.repositories}, report_hash:digest(stable(m)), imported_at:s.created_at, fresh:true, mismatch:[] };
      await this.freshness(s,imported);
      if (!imported.fresh) throw new Error('Manifest does not match snapshot bytes: ' + imported.mismatch.join(', '));
      if (old?.report_hash === imported.report_hash) return { analysis_id:analysisId, unchanged:true };
      if (old) {
        const covered = new Set(m.coverage.files), families = new Set(m.coverage.relation_types);
        const fileOf = (id:string) => { const n=old.manifest.nodes.find(n=>n.id===id); return n?.kind==='symbol'?n.file:id; };
        const retained = old.manifest.edges.filter(e => !(m.coverage.status==='complete' && covered.has(fileOf(e.dependent)) && families.has(e.relation)));
        imported.manifest = {...m, nodes:[...new Map([...old.manifest.nodes,...m.nodes].map(n=>[n.id,n])).values()],
          edges:[...new Map([...retained,...m.edges].map(e=>[stable(e),e])).values()]};
      }
      cat.analyses[analysisId]=imported;
      await this.freshness(s, imported);
      const edgeSignature = (e:Manifest['edges'][number]) => stable({dependent:e.dependent,dependency:e.dependency,relation:e.relation});
      const prior = new Set(old?.manifest.edges.map(edgeSignature) ?? []), after = new Set(imported.manifest.edges.map(edgeSignature));
      const changedEdges = [...(old?.manifest.edges ?? []),...imported.manifest.edges].filter(e=>prior.has(edgeSignature(e))!==after.has(edgeSignature(e)));
      const seeds = changedEdges.flatMap(e=>{const loc=this.mappedFile(imported.manifest,a.mapping,e.dependent);return loc?[fileKey(loc.repository,loc.path)]:[];});
      this.impact(base,s,seeds,'dependency_change');
      return { analysis_id:analysisId, registered, added:[...after].filter(e=>!prior.has(e)).length, removed:[...prior].filter(e=>!after.has(e)).length,
        status:m.coverage.status, manual_relations_preserved:true, retained_previous_observations:m.coverage.status==='partial' };
    });
  }
  async analyses(snapshot?:string) {
    const s=await this.snapshot(snapshot);const cat=this.requireV2(s.data);
    const result=[];
    for(const a of Object.values(cat.analyses)){await this.freshness(s.data,a);result.push({id:a.id,producer:a.manifest.producer,scope:a.manifest.scope,coverage:a.manifest.coverage,fresh:a.fresh,mismatch:a.mismatch,report_hash:a.report_hash});}
    return {snapshot:s.id,analyses:result};
  }
  async dependencyGraph(snapshot?:string, analysisIds?:string[]) {
    const s=await this.snapshot(snapshot);this.requireV2(s.data);
    return {snapshot:s.id,dependencies:this.projected(s.data,analysisIds),observations:Object.values(s.data.catalog!.analyses).filter(a=>!analysisIds||analysisIds.includes(a.id)).map(a=>({analysis_id:a.id,nodes:a.manifest.nodes,dependencies:a.manifest.edges})),
      documentation:s.data.nodes.flatMap(n=>n.relations.filter(r=>r.type==='documents').map(r=>({document:n.id,subject:r.target}))),
      topology:'file projection plus original symbol observations'};
  }
  async setRelations(a:{base_snapshot:string;idempotency_key:string;dependent:string;dependencies:{dependency:string;relation:string}[]}) {
    return this.extension(a.base_snapshot,a.idempotency_key,a,async(s,base)=>{
      this.requireV2(s);const n=s.nodes.find(n=>n.id===a.dependent);if(!n)throw new Error('Unknown dependent');
      for(const e of a.dependencies)if(!s.nodes.some(n=>n.id===e.dependency))throw new Error('Unknown dependency');
      const before=stable(n.relations);
      n.relations=[...n.relations.filter(r=>r.type!=='depends_on'),...a.dependencies.map(e=>({type:'depends_on' as const,target:e.dependency}))];
      if(stable(n.relations)!==before)this.impact(base,s,[fileKey(n.repository,n.path)],'manual_dependency_change');
      return {dependent:n.id,dependencies:a.dependencies};
    });
  }
  override async afterReviews(s:Snapshot,ids:string[]) {
    const cat=this.requireV2(s);
    for(const nodeId of ids)if(!(s.reviews[nodeId]?.length)){
      const n=s.nodes.find(n=>n.id===nodeId)!;const subject=this.subject(s,n);
      if(subject){const artifact=s.nodes.find(x=>x.repository===subject.repository&&x.path===subject.path);
        const h=artifact?s.hashes[artifact.id]:digest(await fileAt(this.repo(subject.repository),s.repositories[subject.repository],subject.path));
        (s.based_on[nodeId]??={})[fileKey(subject.repository,subject.path)]=h;}
      cat.notices=cat.notices.filter(x=>x.document!==nodeId);
    }
  }
  async documentationLinks(a:{base_snapshot:string;idempotency_key:string;document:string;subjects:string[]}) {
    return this.extension(a.base_snapshot,a.idempotency_key,a,async(s,base)=>{
      this.requireV2(s);const n=s.nodes.find(n=>n.id===a.document&&n.kind==='document');if(!n)throw new Error('Unknown document');
      if(a.subjects.some(id=>!s.nodes.some(n=>n.id===id)))throw new Error('Unknown subject');
      n.relations=[...n.relations.filter(r=>r.type!=='documents'),...a.subjects.map(target=>({type:'documents' as const,target}))];
      this.impact(base,s,[fileKey(n.repository,n.path)],'documentation_link_change');
      return {document:n.id,subjects:a.subjects};
    });
  }
  async registerNode(a:{base_snapshot:string;idempotency_key:string;node:Node;expected_hash:string}) {
    return this.extension(a.base_snapshot,a.idempotency_key,a,async s=>{
      this.requireV2(s);
      if(s.nodes.some(n=>n.id===a.node.id||(n.repository===a.node.repository&&n.path===a.node.path)))throw new Error('Node or file already registered');
      if(!s.repositories[a.node.repository])throw new Error('Unknown repository');
      const bytes=await fileAt(this.repo(a.node.repository),s.repositories[a.node.repository],a.node.path);
      if(digest(bytes)!==a.expected_hash)throw new Error('Content conflict');
      s.nodes.push(a.node);s.hashes[a.node.id]=a.expected_hash;
      return {registered:a.node.id};
    });
  }
  async coveragePrepare(a:{base_snapshot:string;idempotency_key:string;coverage:NonNullable<Config['coverage']>}) {
    return this.extension(a.base_snapshot,a.idempotency_key,a,async s=>{
      const c=this.requireV2(s);
      for(const scope of a.coverage)if(!s.repositories[scope.repository]||!s.domains.some(d=>d.id===scope.domain))throw new Error('Unknown coverage repository/domain');
      c.coverage=a.coverage;return {coverage:c.coverage};
    });
  }
  async issuePrepare(a:{base_snapshot:string;idempotency_key:string;document:string;reason:string}) {
    return this.extension(a.base_snapshot,a.idempotency_key,a,async s=>{
      const c=this.requireV2(s);if(!s.nodes.some(n=>n.id===a.document&&n.kind==='document'))throw new Error('Unknown document');
      c.notices.push({action:'update',document:a.document,subject:a.document,reason:a.reason,change:s.change_id});
      (s.reviews[a.document]??=[]).push({id:randomUUID(),source:'documented_issue',before:s.hashes[a.document],after:s.hashes[a.document],via:[a.reason],change:s.change_id});
      return {document:a.document,action:'update'};
    });
  }
  async documentationPlan(options:{snapshot?:string;since_snapshot?:string;domain?:string;action?:string;offset?:number;limit?:number}={}) {
    const {id:snapshot,data:s}=await this.snapshot(options.snapshot),c=this.requireV2(s);
    const tasks=new Map<string,Task>(),excluded:any[]=[],files:{repository:string;path:string;domain?:string;mode:string}[]=[];
    const add=(action:string,subject:string,reason:string,document?:string,blockers:string[]=[])=>{
      const key='task-'+keyOf({action,subject,document:document??null});
      const t=tasks.get(key)??{key,action,subject,document,reasons:[],blockers:[],priority:action==='refresh_analysis'?0:action==='resolve_mapping'?1:2,state:'open',snapshot};
      if(!t.reasons.includes(reason))t.reasons.push(reason);t.blockers=[...new Set([...t.blockers,...blockers])];tasks.set(key,t);
    };
    for(const repository of Object.keys(s.repositories)) {
      const entries=(await git(this.repo(repository),['ls-tree','-rz',s.repositories[repository]])).toString().split('\0').filter(Boolean);
      for(const e of entries){const p=e.slice(e.indexOf('\t')+1),mode=e.slice(0,6);
        const scopes=c.coverage.filter(x=>x.repository===repository&&under(p,x.prefix)).sort((a,b)=>b.prefix.length-a.prefix.length);
        if(c.coverage.some(x=>x.repository===repository)&&!scopes.length){excluded.push({repository,path:p,reason:'outside declared coverage roots'});continue;}
        const scope=scopes[0],ambiguous=scope&&scopes.some(x=>x.prefix.length===scope.prefix.length&&x.domain!==scope.domain);
        const exclusion=scope?.exclusions.find(x=>under(p,x.prefix));
        if(exclusion){excluded.push({repository,path:p,reason:exclusion.reason});continue;}
        if(options.domain&&scope?.domain!==options.domain)continue;
        files.push({repository,path:p,domain:ambiguous?undefined:(scope?.domain??s.nodes.find(n=>n.repository===repository&&n.path===p)?.domain),mode});
      }
    }
    for(const artifactId of c.migration.unresolved){
      const artifact=s.nodes.find(n=>n.id===artifactId);
      if(artifact&&!s.nodes.some(n=>n.card&&this.subject(s,n)?.repository===artifact.repository&&this.subject(s,n)?.path===artifact.path))
        add('resolve_mapping',fileKey(artifact.repository,artifact.path),'migration_primary_card_ambiguous');
    }
    const covered=new Set<string>();
    for(const f of files) {
      const subject=fileKey(f.repository,f.path);
      if(!f.domain)add('resolve_mapping',subject,'coverage_domain_ambiguous');
      const self=s.nodes.find(n=>n.kind==='document'&&n.repository===f.repository&&n.path===f.path);
      if(self){covered.add(subject);continue;}
      const cards=s.nodes.filter(n=>n.kind==='document'&&this.subject(s,n)?.repository===f.repository&&this.subject(s,n)?.path===f.path);
      if(!cards.length)add('create_card',subject,'missing_primary_card',undefined,f.domain?[]:['resolve_domain']);
      else if(cards.length>1)add('resolve_mapping',subject,'multiple_primary_cards');
      else covered.add(subject);
    }
    for(const n of s.nodes.filter(n=>n.kind==='document')) {
      const subject=this.subject(s,n),key=subject?fileKey(subject.repository,subject.path):fileKey(n.repository,n.path);
      if(options.domain&&n.domain!==options.domain)continue;
      if(n.card){
        if(n.card.mode==='full'){const text=(await fileAt(this.repo(n.repository),s.repositories[n.repository],n.path)).toString();if(!frontmatter(text).body.replace(/^#+.*$/gm,'').trim())add('complete_card',key,'full_body_required',n.id);}
        if(!files.some(f=>fileKey(f.repository,f.path)===key)&&!excluded.some(f=>fileKey(f.repository,f.path)===key))add('retire',key,'subject_missing_from_snapshot',n.id);
        if(n.card.mode!=='full'&&!n.card.reason?.trim())add('complete_card',key,'reason_required',n.id);
        if(n.card.mode==='delegated'&&!n.card.references.length)add('complete_card',key,'delegation_reference_required',n.id);
        for(const ref of n.card.references){
          const target=s.nodes.find(t=>t.id===ref.document&&t.kind==='document');
          if(!target)add('repair_reference',key,'missing_document:'+ref.document,n.id);
          else if(ref.section){const text=(await fileAt(this.repo(target.repository),s.repositories[target.repository],target.path)).toString();if(!sections(text).some(h=>h.id===ref.section))add('repair_reference',key,'missing_section:'+ref.document+'#'+ref.section,n.id);}
        }
      }
      for(const reason of s.reviews[n.id]??[])add('review',key,`${reason.source} [${reason.change}]: ${reason.via.join(' -> ')}`,n.id);
    }
    for(const a of Object.values(c.analyses)){
      await this.freshness(s,a);
      if(!a.fresh)add('refresh_analysis',a.id,'source_bytes_changed: '+a.mismatch.join(', '));
      if(a.manifest.coverage.status==='partial')for(const t of tasks.values())if(t.action==='review')t.blockers.push('impact_graph_partial:'+a.id);
      for(const n of a.manifest.nodes)if(n.kind==='external')add('resolve_mapping',a.id+':'+n.id,'external_dependency:'+n.name);
    }
    for(const notice of c.notices){
      if(options.domain&&notice.document&&s.nodes.find(n=>n.id===notice.document)?.domain!==options.domain)continue;
      add(notice.action,notice.subject,notice.reason,notice.document);
    }
    let items=[...tasks.values()];
    if(options.since_snapshot){
      const old=await this.documentationPlan({snapshot:options.since_snapshot,domain:options.domain,limit:100000});
      const previous=new Map(old.items.map(t=>[t.key,stable({reasons:t.reasons,blockers:t.blockers})]));
      items=items.filter(t=>previous.get(t.key)!==stable({reasons:t.reasons,blockers:t.blockers}));
    }
    if(options.action)items=items.filter(t=>t.action===options.action);
    items.sort((a,b)=>a.priority-b.priority||a.key.localeCompare(b.key));
    const total=items.length,offset=options.offset??0,limit=options.limit??50;
    return {snapshot,total,offset,items:items.slice(offset,offset+limit),coverage:{files:files.length,covered:covered.size,missing:files.length-covered.size,excluded},
      analysis_mode:options.since_snapshot?'task_delta':'full_audit'};
  }
}
