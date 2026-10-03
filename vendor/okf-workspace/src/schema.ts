import { z } from 'zod';

export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/)
  .refine(v => !v.includes('..') && !v.endsWith('.') && !v.endsWith('.lock'), 'ID must also be safe as a Git ref component');
export const revision = z.string().regex(/^[a-f0-9]{40,64}$/);
export const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const relativePath = z.string().min(1).refine(p =>
  !p.includes('\\') && !p.includes('\0') && !p.includes(':') &&
  p.split('/').every(s => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git'),
  'Use a relative path without traversal or .git');
export const relation = z.object({
  type: z.enum(['depends_on', 'documents', 'implements', 'references', 'related_to']),
  target: id,
  target_hash: hash.optional(),
  section: id.optional(),
  source_section: id.optional()
}).strict();
export const cardSchema = z.object({
  subject: z.object({ repository: id, path: relativePath, artifact_id: id.optional() }).strict(),
  mode: z.enum(['full', 'delegated', 'minimal']), reason: z.string().optional(),
  references: z.array(z.object({ document: id, section: id.optional() }).strict()).default([])
}).strict();
export const coverageSchema = z.array(z.object({
  repository: id, prefix: z.union([relativePath, z.literal('')]).default(''), domain: id,
  exclusions: z.array(z.object({ prefix: relativePath, reason: z.string().min(1) }).strict()).default([])
}).strict());
export const nodeSchema = z.object({
  id, kind: z.enum(['document', 'artifact']), domain: id, repository: id,
  path: relativePath, title: z.string().min(1), description: z.string().min(1),
  card: cardSchema.nullable().optional(), version: z.string().optional(), relations: z.array(relation).default([])
}).strict();
export const configSchema = z.object({
  schema_version: z.literal(1),
  repositories: z.record(id, z.object({ path: z.string().min(1), ref: z.string().default('HEAD') }).strict()),
  domains: z.array(z.object({ id, title: z.string().min(1), description: z.string().min(1), rules: z.string().default('') }).strict()).min(1),
  nodes: z.array(nodeSchema), coverage: coverageSchema.optional()
}).strict();
const replace = z.object({ action: z.literal('replace'), id, expected_hash: hash, content: z.string() }).strict();
const patch = z.object({ action: z.literal('patch'), id, expected_hash: hash, patch: z.string() }).strict();
const section = z.object({ action: z.literal('replace_section'), id, expected_hash: hash, section_id: id, content: z.string() }).strict();
const create = z.object({ action: z.literal('create'), node: nodeSchema, content: z.string() }).strict();
const move = z.object({ action: z.literal('move'), id, expected_hash: hash, path: relativePath }).strict();
const del = z.object({ action: z.literal('delete'), id, expected_hash: hash }).strict();
const metadata = z.object({ action: z.literal('metadata'), id, expected_hash: hash,
  title: z.string().min(1).optional(), description: z.string().min(1).optional(),
  card: cardSchema.nullable().optional(), version: z.string().optional(), relations: z.array(relation).optional() }).strict();
const review = z.object({ action: z.literal('review'), id, expected_hash: hash,
  reason_ids: z.array(id).min(1), evidence: z.string().min(1), actor: z.string().min(1)
}).strict();
export const operation = z.discriminatedUnion('action', [replace, patch, section, create, move, del, metadata, review]);
export const prepareSchema = z.object({ base_snapshot: revision, idempotency_key: id,
  message: z.string().min(1).max(500), operations: z.array(operation).min(1).max(100)
}).strict();
export type Node = z.infer<typeof nodeSchema>;
export type Config = z.infer<typeof configSchema>;
export type Prepare = z.infer<typeof prepareSchema>;
export type Reason = { id: string; source: string; before: string | null; after: string | null; via: string[]; change: string };
export type Review = { target: string; reason_ids: string[]; evidence: string; actor: string; at: string; change: string };
export type Snapshot = {
  catalog?: import("./catalog-model.js").Catalog;
  schema_version: 1; parent: string | null; change_id: string; created_at: string;
  repositories: Record<string, string>; domains: Config['domains']; nodes: Node[];
  hashes: Record<string, string>; reviews: Record<string, Reason[]>; review_history: Review[];
  based_on: Record<string, Record<string, string>>;
};
