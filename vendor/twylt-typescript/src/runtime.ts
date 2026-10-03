import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import formatsPlugin, { type FormatsPlugin } from 'ajv-formats';
const addFormats = formatsPlugin as unknown as FormatsPlugin;
import type { Static, TSchema } from '@sinclair/typebox';
import { DESCRIBE_MODES, TWYLT_FORMAT_VERSION, type DescribeMode, type ErrorFormat, type ToolDefinition, type TwyltErrorBody } from './types.js';
import { withIdentity } from './schema.js';

const EXIT = { input: 2, output: 3, protocol: 4, biz: 5 } as const;

type Transport = 'cli' | 'stdin' | 'file';

export class Tool<I extends TSchema, O extends TSchema> {
  readonly definition: ToolDefinition<I, O>;
  private readonly inputSchema: I;
  private readonly outputSchema: O;
  private readonly validateInput: ValidateFunction;
  private readonly validateOutput: ValidateFunction;

  constructor(definition: ToolDefinition<I, O>) {
    this.definition = definition;
    this.inputSchema = withIdentity(definition.inputSchema, definition.inputSchemaName, definition.inputSchemaVersion);
    this.outputSchema = withIdentity(definition.outputSchema, definition.outputSchemaName, definition.outputSchemaVersion);
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    this.validateInput = ajv.compile(this.inputSchema);
    this.validateOutput = ajv.compile(this.outputSchema);
  }

  describe(mode: DescribeMode): unknown {
    const d = this.definition;
    switch (mode) {
      case 'brief': return d.description;
      case 'schema': return { inputSchema: this.inputSchema, outputSchema: this.outputSchema };
      case 'requirements': return d.requirements ?? { tool: 'npm', format: 'package.json', content: '' };
      case 'few_shots': return d.fewShots ?? [];
      case 'json_spec': return {
        format_version: TWYLT_FORMAT_VERSION,
        name: d.name,
        version: d.version,
        description: d.description,
        requirements: d.requirements ?? { tool: 'npm', format: 'package.json', content: '' },
        inputSchema: this.inputSchema,
        outputSchema: this.outputSchema,
        few_shots: d.fewShots ?? [],
      };
    }
  }

  async execute(value: unknown): Promise<Static<O>> {
    if (!this.validateInput(value)) throw new ValidationFailure('input', this.validateInput.errors ?? []);
    let result: unknown;
    try { result = await this.definition.biz(value as Static<I>); }
    catch (cause) { throw new BusinessFailure(cause); }
    if (!this.validateOutput(result)) throw new ValidationFailure('output', this.validateOutput.errors ?? []);
    return result as Static<O>;
  }

  async run(argv = process.argv.slice(2), env = process.env): Promise<number> {
    const opts = parseServiceOptions(argv, env);
    if (opts.service === 'help') { process.stdout.write(this.help()); return 0; }
    if (opts.service === 'version') { process.stdout.write(`${this.definition.name} ${this.definition.version}\n`); return 0; }
    if (opts.service === 'short-version') { process.stdout.write(`${this.definition.version}\n`); return 0; }

    try {
      const envDescribe = env.INPUT_DESCRIBE;
      if (envDescribe) {
        const mode = parseDescribe(envDescribe);
        writeJsonStdout(this.describe(mode));
        return 0;
      }
      const { transport, value } = await readTransport(opts.args);
      const describe = extractDescribe(value, transport);
      if (describe) {
        writeJsonStdout(this.describe(describe));
        return 0;
      }
      const result = await this.execute(value);
      if (transport === 'file') await writeFile('output.json', `${JSON.stringify(result)}\n`, 'utf8');
      else writeJsonStdout(result);
      return 0;
    } catch (error) {
      const normalized = normalizeError(error, opts.debug);
      renderError(normalized.body, opts.errorFormat);
      return normalized.exitCode;
    }
  }

  help(): string {
    return `${this.definition.name} ${this.definition.version}\n${this.definition.description}\n\nUsage:\n  tool '<json>'\n  printf '<json>' | tool\n  tool                       # reads input.json\n\nDiscovery: brief, schema, requirements, few_shots, json_spec\nOptions: -h, --help, --version, -v, --error-format human|json, --debug\n`;
  }
}

export function defineTool<I extends TSchema, O extends TSchema>(definition: ToolDefinition<I, O>): Tool<I, O> {
  return new Tool(definition);
}

class ValidationFailure extends Error {
  constructor(readonly stage: 'input' | 'output', readonly issues: ErrorObject[]) { super(`${stage === 'input' ? 'Input' : 'Output'} validation failed`); }
}
class BusinessFailure extends Error { constructor(readonly causeValue: unknown) { super(causeValue instanceof Error ? causeValue.message : String(causeValue)); } }
class ProtocolFailure extends Error { constructor(readonly stage: 'transport' | 'describe', message: string, readonly causeValue?: unknown) { super(message); } }

function parseServiceOptions(argv: string[], env: NodeJS.ProcessEnv) {
  let errorFormat: ErrorFormat = env.TWYLT_ERROR_FORMAT === 'human' ? 'human' : 'json';
  let debug = env.TWYLT_DEBUG === '1' || env.TWYLT_DEBUG === 'true';
  let service: 'help' | 'version' | 'short-version' | undefined;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') service = 'help';
    else if (arg === '--version') service = 'version';
    else if (arg === '-v') service = 'short-version';
    else if (arg === '--debug') debug = true;
    else if (arg === '--error-format') {
      const next = argv[++i]; if (next !== 'human' && next !== 'json') throw new ProtocolFailure('transport', 'Invalid --error-format'); errorFormat = next;
    } else if (arg.startsWith('--error-format=')) {
      const value = arg.slice(15); if (value !== 'human' && value !== 'json') throw new ProtocolFailure('transport', 'Invalid --error-format'); errorFormat = value;
    } else args.push(arg);
  }
  return { errorFormat, debug, service, args };
}

async function readTransport(args: string[]): Promise<{transport: Transport; value: unknown}> {
  if (args.length) return { transport: 'cli', value: parseJsonObject(args[0]!, 'CLI argument') };
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (text) return { transport: 'stdin', value: parseJsonObject(text, 'stdin') };
  }
  try { return { transport: 'file', value: parseJsonObject(await readFile('input.json', 'utf8'), 'input.json') }; }
  catch (error) { if (error instanceof ProtocolFailure) throw error; throw new ProtocolFailure('transport', 'Unable to read input.json', error); }
}

function parseJsonObject(text: string, source: string): unknown {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new ProtocolFailure('transport', `Invalid JSON from ${source}`, error); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolFailure('transport', `${source} must contain a JSON object`);
  return value;
}
function parseDescribe(value: string): DescribeMode {
  if ((DESCRIBE_MODES as readonly string[]).includes(value)) return value as DescribeMode;
  throw new ProtocolFailure('describe', `Unsupported describe mode: ${value}`);
}
function extractDescribe(value: unknown, transport: Transport): DescribeMode | undefined {
  if (transport === 'file') return undefined;
  const describe = (value as Record<string, unknown>).describe;
  if (describe === undefined || describe === null || describe === '') return undefined;
  if (typeof describe !== 'string') throw new ProtocolFailure('describe', 'describe must be a string');
  return parseDescribe(describe);
}
function writeJsonStdout(value: unknown): void { process.stdout.write(`${JSON.stringify(value)}\n`); }
function toIssues(errors: ErrorObject[]) { return errors.map(e => ({ path: e.instancePath || '/', code: e.keyword, message: e.message ?? 'validation error', ...(e.data !== undefined ? { value: e.data } : {}) })); }
function stackOf(value: unknown): string | undefined { return value instanceof Error ? value.stack : undefined; }
function normalizeError(error: unknown, debug: boolean): { body: TwyltErrorBody; exitCode: number } {
  if (error instanceof ValidationFailure) return { exitCode: error.stage === 'input' ? EXIT.input : EXIT.output, body: { type: 'validation_error', source: 'twylt', stage: error.stage, message: error.message, errors: toIssues(error.issues), ...(debug && error.stack ? { traceback: error.stack } : {}) } };
  if (error instanceof BusinessFailure) return { exitCode: EXIT.biz, body: { type: 'execution_error', source: 'tool', stage: 'biz', message: error.message, ...(debug && stackOf(error.causeValue) ? { traceback: stackOf(error.causeValue)! } : {}) } };
  const p = error instanceof ProtocolFailure ? error : new ProtocolFailure('transport', error instanceof Error ? error.message : String(error), error);
  return { exitCode: EXIT.protocol, body: { type: 'protocol_error', source: 'twylt', stage: p.stage, message: p.message, ...(debug && stackOf(p.causeValue ?? p) ? { traceback: stackOf(p.causeValue ?? p)! } : {}) } };
}
function renderError(body: TwyltErrorBody, format: ErrorFormat): void {
  if (format === 'json') process.stderr.write(`${JSON.stringify({ error: body })}\n`);
  else {
    process.stderr.write(`${body.source}:${body.stage}: ${body.message}\n`);
    for (const issue of body.errors ?? []) process.stderr.write(`  ${issue.path}: ${issue.message} [${issue.code}]\n`);
    if (body.traceback) process.stderr.write(`${body.traceback}\n`);
  }
}
