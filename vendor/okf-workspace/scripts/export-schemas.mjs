import fs from 'node:fs/promises';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { configSchema, definitions, CatalogWorkspace as Workspace, manifestSchema } from '../dist/index.js';
await fs.mkdir('schemas', { recursive: true });
await fs.writeFile('schemas/workspace.schema.json', JSON.stringify(zodToJsonSchema(configSchema), null, 2) + '\n');
const tools = Object.fromEntries(Object.entries(definitions(new Workspace('/unused'))).map(([name, t]) => [name, {
  description: t.description, input_schema: zodToJsonSchema(t.schema)
}]));
await fs.writeFile('schemas/tools.json', JSON.stringify(tools, null, 2) + '\n');

await fs.writeFile('schemas/dependency-manifest.schema.json', JSON.stringify(zodToJsonSchema(manifestSchema), null, 2) + '\n');
