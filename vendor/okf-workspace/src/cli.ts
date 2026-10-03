#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CatalogWorkspace as Workspace } from './catalog.js';
import { invoke, server, definitions, VERSION } from './interface.js';

async function main() {
  const argv = process.argv.slice(2);
  const stateIndex = argv.indexOf('--state');
  const state = stateIndex < 0 ? process.env.OKF_WORKSPACE_STATE : argv.splice(stateIndex, 2)[1];
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(`okf-workspace ${VERSION}
Usage: okf-workspace --state /absolute/state COMMAND
  init CONFIG.json           Import committed local Git repositories
  mcp                        Start stdio MCP server
  call TOOL [REQUEST.json|-]  JSON request/response (file default: input.json)
  tools                      List tool names and descriptions
  describe [TOOL]            JSON input schema and description; all if omitted
  export DEST [SNAPSHOT]      Export a snapshot as ordinary Git working copies
  --version                  Print version
Environment: OKF_WORKSPACE_STATE. Requests use UTF-8 JSON; errors go to stdout
as JSON with exit code 1. MCP stdout is reserved for protocol messages.`); return;
  }
  if (command === '--version') { console.log(VERSION); return; }
  if (!state) throw new Error('--state or OKF_WORKSPACE_STATE required');
  const w = new Workspace(state);
  if (command === 'mcp') { await server(w).connect(new StdioServerTransport()); return; }
  let result: unknown;
  if (command === 'init') {
    if (!args[0]) throw new Error('Config filename required');
    result = await w.init(JSON.parse(await fs.readFile(args[0], 'utf8')), path.dirname(path.resolve(args[0])));
  } else if (command === 'call') {
    const source = args[1] ?? 'input.json';
    const input = source === '-' ? await new Promise<string>((resolve, reject) => {
      let s = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', b => { s += b; if (s.length > 16 * 1024 * 1024) { reject(new Error('Request too large')); process.stdin.destroy(); } });
      process.stdin.on('end', () => resolve(s)); process.stdin.on('error', reject);
    }) : await fs.readFile(source, 'utf8');
    result = await invoke(w, args[0], JSON.parse(input));
  } else if (command === 'export') {
    if (!args[0]) throw new Error('Export destination required');
    result = await w.exportSnapshot(args[0], args[1]);
  } else if (command === 'tools') result = Object.entries(definitions(w)).map(([name, t]) => ({ name, description: t.description }));
  else if (command === 'describe') {
    const all = Object.entries(definitions(w));
    if (args[0] && !all.some(([name]) => name === args[0])) throw new Error('Unknown tool');
    result = all.filter(([name]) => !args[0] || name === args[0]).map(([name, t]) => ({ name, version: VERSION, description: t.description, input_schema: zodToJsonSchema(t.schema), output_schema: { type: 'object' } }));
  }
  else throw new Error(`Unknown command: ${command}`);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => {
  const out = JSON.stringify({ error: e.message });
  if (process.argv.includes('mcp')) console.error(out); else console.log(out);
  process.exitCode = 1;
});
