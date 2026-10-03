import { z } from 'zod';
import { prepareSchema, operation, nodeSchema } from './schema.js';
// Legacy relations remain readable internally for v0.1 history, not in new write schemas.
const publicOps = operation.options.map(o => {
  const action=o.shape.action.value;
  if(action==='metadata')return (o as any).omit({relations:true});
  if(action==='create')return (o as any).extend({node:nodeSchema.omit({relations:true})});
  return o;
});
export const publicPrepareSchema=prepareSchema.extend({operations:z.array(z.discriminatedUnion('action',publicOps as any)).min(1).max(100)});
export function publicNode(n:any):any {
  if(!n||!n.relations)return n;
  const {relations,...rest}=n;
  return {...rest,dependencies:relations.filter((r:any)=>['depends_on','implements'].includes(r.type)).map((r:any)=>({dependent:n.id,dependency:r.target,relation:r.type,...(r.target_hash?{dependency_hash:r.target_hash}:{}),...(r.section?{dependency_section:r.section}:{})})),
    documentation:relations.filter((r:any)=>r.type==='documents').map((r:any)=>({document:n.id,subject:r.target})),
    references:relations.filter((r:any)=>['references','related_to'].includes(r.type)).map((r:any)=>({document:n.id,related:r.target,relation:r.type}))};
}
