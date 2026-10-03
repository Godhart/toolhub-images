import { readdir } from 'node:fs/promises';
import { Type, defineTool } from '../../src/index.js';

const Input = Type.Object({ path: Type.String({ description: 'Directory to list' }) });
const Output = Type.Object({ entries: Type.Array(Type.String()) });

const tool = defineTool({
  name: 'list-directory', version: '1.0.0', description: 'List entries in a directory.',
  inputSchema: Input, outputSchema: Output,
  inputSchemaName: 'ListDirectoryInput', inputSchemaVersion: '1.0.0',
  outputSchemaName: 'ListDirectoryOutput', outputSchemaVersion: '1.0.0',
  requirements: { tool: 'npm', format: 'package.json', content: '{"engines":{"node":">=22"}}' },
  fewShots: [{ input: { path: '.' }, output: { entries: ['package.json'] } }],
  async biz({ path }) { return { entries: await readdir(path) }; }
});

process.exitCode = await tool.run();
