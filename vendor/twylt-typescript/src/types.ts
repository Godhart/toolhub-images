import type { Static, TSchema } from '@sinclair/typebox';

export const TWYLT_FORMAT_VERSION = '1.8' as const;
export const DESCRIBE_MODES = ['brief', 'schema', 'requirements', 'few_shots', 'json_spec'] as const;
export type DescribeMode = typeof DESCRIBE_MODES[number];
export type ErrorFormat = 'json' | 'human';
export type ErrorStage = 'transport' | 'describe' | 'input' | 'biz' | 'output';
export type ErrorSource = 'twylt' | 'tool';

export interface Requirements {
  tool: string;
  format: string;
  content: string;
}

export interface FewShot<I = unknown, O = unknown> {
  input: I;
  output: O;
}

export interface ToolDefinition<I extends TSchema, O extends TSchema> {
  name: string;
  version: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  inputSchemaName?: string;
  inputSchemaVersion?: string;
  outputSchemaName?: string;
  outputSchemaVersion?: string;
  requirements?: Requirements;
  fewShots?: FewShot<Static<I>, Static<O>>[];
  biz(data: Static<I>): Static<O> | Promise<Static<O>>;
}

export interface Issue {
  path: string;
  code: string;
  message: string;
  value?: unknown;
}

export interface TwyltErrorBody {
  type: string;
  source: ErrorSource;
  stage: ErrorStage;
  message: string;
  errors?: Issue[];
  traceback?: string;
}
