import { z } from 'zod';
import { id, revision, relativePath, coverageSchema, nodeSchema, hash } from './schema.js';
import { manifestSchema } from './manifest.js';
import { CatalogWorkspace } from './catalog.js';
const base={base_snapshot:revision,idempotency_key:id};
export function catalogDefinitions(w:CatalogWorkspace) {
  return {
    migration_prepare:{description:'Prepare a v0.1 to v0.2 snapshot migration. Old snapshots remain unchanged; apply with changes_apply.',schema:z.object(base).strict(),run:(a:any)=>w.migrate(a)},
    dependencies_import_prepare:{description:'Validate byte hashes, map source roots and prepare provenance-aware dependency import. Partial reports never remove observations. Apply with changes_apply.',schema:z.object({...base,manifest:manifestSchema,mapping:z.record(id,z.object({repository:id,prefix:z.union([relativePath,z.literal('')]).default('')}).strict())}).strict(),run:(a:any)=>w.importDependencies(a)},
    dependencies_sources:{description:'List analysis profiles, completeness and freshness against immutable source bytes.',schema:z.object({snapshot:revision.optional()}).strict(),run:(a:any)=>w.analyses(a.snapshot)},
    dependencies_graph:{description:'Get dependent/dependency graph and original entity observations. Manual and imported provenance remain separate.',schema:z.object({snapshot:revision.optional(),analysis_ids:z.array(id).optional()}).strict(),run:(a:any)=>w.dependencyGraph(a.snapshot,a.analysis_ids)},
    dependencies_set_prepare:{description:'Replace manual dependencies of one registered dependent. Imported observations remain unchanged.',schema:z.object({...base,dependent:id,dependencies:z.array(z.object({dependency:id,relation:z.literal('depends_on').default('depends_on')}).strict())}).strict(),run:(a:any)=>w.setRelations(a)},
    documentation_links_set_prepare:{description:'Replace documented subjects of a document with explicit document/subject roles.',schema:z.object({...base,document:id,subjects:z.array(id)}).strict(),run:(a:any)=>w.documentationLinks(a)},
    nodes_register_prepare:{description:'Register an existing tracked UTF-8 file or OKF document without rewriting its bytes.',schema:z.object({...base,node:nodeSchema.omit({relations:true}),expected_hash:hash}).strict(),run:(a:any)=>w.registerNode({...a,node:{...a.node,relations:[]}})},
    coverage_set_prepare:{description:'Declare file coverage roots and explicit exclusions with reasons.',schema:z.object({...base,coverage:coverageSchema}).strict(),run:(a:any)=>w.coveragePrepare(a)},
    documentation_issue_prepare:{description:'Record a confirmed documentation mismatch. Creates an update task and review cause.',schema:z.object({...base,document:id,reason:z.string().min(1)}).strict(),run:(a:any)=>w.issuePrepare(a)},
    documentation_plan:{description:'Plan create_card/complete_card/review/update/repair_reference/retire/refresh_analysis/resolve_mapping tasks. Stable deduplicated keys; since_snapshot returns task delta.',schema:z.object({snapshot:revision.optional(),since_snapshot:revision.optional(),domain:id.optional(),action:z.enum(['create_card','complete_card','review','update','repair_reference','retire','refresh_analysis','resolve_mapping']).optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(50)}).strict(),run:(a:any)=>w.documentationPlan(a)},
    documentation_coverage:{description:'Report all in-scope Git files, card coverage and exclusions without recursively requiring cards for card documents.',schema:z.object({snapshot:revision.optional(),domain:id.optional()}).strict(),run:async(a:any)=>{const p=await w.documentationPlan(a);return {snapshot:p.snapshot,...p.coverage};}}
  };
}
