import fs from 'node:fs/promises';
import path from 'node:path';
import { run, git } from '../src/git.js';
import { Workspace } from '../src/workspace.js';

export const guide = `---
type: Documentation
title: Input reader
description: Input protocol and examples.
summary: Reads JSON input for a local tool.
---

# Input reader {#overview}

## Protocol {#protocol}

Read one JSON object from input.json.

## Examples {#examples}

An empty JSON object is valid.
`;
export async function setup(root: string, single = false) {
  const runtime = path.join(root, 'sources', 'runtime');
  const docs = single ? runtime : path.join(root, 'sources', 'docs');
  const integration = single ? runtime : path.join(root, 'sources', 'integration');
  for (const repo of new Set([runtime, docs, integration])) {
    await fs.mkdir(repo, { recursive: true }); await run('git', ['init', repo]);
    await git(repo, ['config', 'user.name', 'Demo']); await git(repo, ['config', 'user.email', 'demo@localhost']);
  }
  await fs.mkdir(path.join(runtime, 'src'), { recursive: true });
  await fs.mkdir(path.join(docs, 'knowledge'), { recursive: true });
  await fs.mkdir(path.join(integration, 'knowledge'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'src/input.py'), 'def read_input():\n    return {}\n');
  await fs.writeFile(path.join(runtime, 'src/client.py'), 'from input import read_input\n');
  await fs.writeFile(path.join(docs, 'knowledge/input.md'), guide);
  await fs.writeFile(path.join(integration, 'knowledge/integration.md'), '---\ntype: Guide\n---\n# Integration {#integration}\nUse the input reader.\n');
  for (const repo of new Set([runtime, docs, integration])) { await git(repo, ['add', '.']); await git(repo, ['commit', '-m', 'Initial example']); }
  const config = {
    schema_version: 1,
    repositories: { runtime: { path: runtime }, ...(single ? {} : { docs: { path: docs }, integration: { path: integration } }) },
    domains: [
      { id: 'tools', title: 'Tools', description: 'Local tool implementations', rules: 'Keep stable IDs and document input behavior.' },
      { id: 'integration', title: 'Integration', description: 'Clients and integration guides', rules: 'Review when upstream contracts change.' }
    ],
    nodes: [
      { id: 'input-reader', kind: 'artifact', domain: 'tools', repository: 'runtime', path: 'src/input.py', title: 'Input reader', description: 'Reads tool input.' },
      { id: 'client', kind: 'artifact', domain: 'integration', repository: 'runtime', path: 'src/client.py', title: 'Client', description: 'Uses input reader.', relations: [{ type: 'depends_on', target: 'input-reader' }] },
      { id: 'input-guide', kind: 'document', domain: 'tools', repository: single ? 'runtime' : 'docs', path: 'knowledge/input.md', title: 'Input guide', description: 'JSON input protocol.', relations: [{ type: 'documents', target: 'input-reader' }] },
      { id: 'integration-guide', kind: 'document', domain: 'integration', repository: single ? 'runtime' : 'integration', path: 'knowledge/integration.md', title: 'Integration', description: 'Input integration instructions.', relations: [{ type: 'depends_on', target: 'input-guide', section: 'protocol' }] }
    ]
  };
  const configPath = path.join(root, 'workspace.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const w = new Workspace(path.join(root, 'state')); await w.init(config);
  return { w, runtime, docs, config, configPath };
}
