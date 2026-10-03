import { z } from 'zod';
import { hash, id, relativePath } from './schema.js';
const extId = z.string().min(1).max(512);
const file = z.object({ id: extId, kind: z.literal('file'), source: id, path: relativePath, content_hash: hash }).strict();
const symbol = z.object({ id: extId, kind: z.literal('symbol'), name: z.string().min(1), file: extId, attributes: z.record(z.unknown()).default({}), line: z.number().int().positive().optional() }).strict();
const external = z.object({ id: extId, kind: z.literal('external'), name: z.string().min(1), uri: z.string().optional() }).strict();
export const manifestSchema = z.object({
  format: z.literal('dependency-manifest'), version: z.literal('1.0'),
  producer: z.object({ name: z.string().min(1), version: z.string().min(1), analyzer: z.string().min(1) }).strict(),
  scope: z.object({ project: z.string().min(1), profile: z.string().min(1), area: z.string().min(1), configuration: z.record(z.unknown()).default({}) }).strict(),
  sources: z.array(z.object({ id, revision: z.string().optional() }).strict()).min(1),
  nodes: z.array(z.discriminatedUnion('kind', [file, symbol, external])),
  edges: z.array(z.object({ dependent: extId, dependency: extId, relation: z.string().min(1),
    evidence: z.object({ file: extId, line: z.number().int().positive().optional(), precision: z.enum(['file','symbol','line']) }).strict().optional(), note: z.string().optional() }).strict()),
  coverage: z.object({ status: z.enum(['complete','partial']), files: z.array(extId), relation_types: z.array(z.string().min(1)), limitations: z.array(z.string()) }).strict(),
  diagnostics: z.array(z.object({ severity: z.enum(['info','warning','error']), code: z.string().min(1), message: z.string() }).strict())
}).strict();
export type Manifest = z.infer<typeof manifestSchema>;
export function validateManifest(value: unknown): Manifest {
  const m = manifestSchema.parse(value), nodes = new Map(m.nodes.map(n => [n.id, n]));
  if (nodes.size !== m.nodes.length || new Set(m.sources.map(s => s.id)).size !== m.sources.length) throw new Error('Duplicate manifest identity');
  const filePaths = new Set<string>();
  for (const n of m.nodes) {
    if (n.kind === 'file') {
      if (!m.sources.some(s => s.id === n.source)) throw new Error('Unknown source root');
      const key = n.source + ':' + n.path;
      if (filePaths.has(key)) throw new Error('Duplicate file location'); filePaths.add(key);
    }
    if (n.kind === 'symbol' && !['file','external'].includes(nodes.get(n.file)?.kind ?? '')) throw new Error('Symbol has no file');
  }
  for (const e of m.edges) {
    if (!nodes.has(e.dependent) || !nodes.has(e.dependency)) throw new Error('Dangling dependency endpoint');
    if (e.evidence && !['file','external'].includes(nodes.get(e.evidence.file)?.kind ?? '')) throw new Error('Invalid evidence file');
  }
  if (m.coverage.files.some(k => nodes.get(k)?.kind !== 'file')) throw new Error('Invalid coverage file');
  if (m.coverage.status === 'complete' && (m.diagnostics.some(d => d.severity === 'error') || m.nodes.some(n => n.kind === 'external'))) throw new Error('Complete report cannot contain errors or external unresolved objects');
  return m;
}
