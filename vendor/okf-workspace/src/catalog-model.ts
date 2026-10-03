import type { Manifest } from './manifest.js';
import type { Config } from './schema.js';
export type Mapping = Record<string, { repository: string; prefix: string }>;
export type Analysis = { id: string; manifest: Manifest; mapping: Mapping; repositories: Record<string,string>; report_hash: string; imported_at: string; fresh: boolean; mismatch: string[] };
export type Catalog = { version: 2; coverage: NonNullable<Config['coverage']>; analyses: Record<string, Analysis>; migration: { unresolved: string[] }; notices: { action: string; document?: string; subject: string; reason: string; change: string }[] };
export type Task = { key: string; action: string; document?: string; subject?: string; reasons: string[]; blockers: string[]; priority: number; state: 'open'; snapshot: string };
