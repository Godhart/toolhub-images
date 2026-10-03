import path from 'node:path';
import { setup } from './setup.js';

const root = path.resolve(process.argv[2] ?? 'demo-workspace');
const { w } = await setup(root);
const base = await w.snapshot();
const prepared = await w.prepare({
  base_snapshot: base.id, idempotency_key: 'demo-update', message: 'Update reader and protocol documentation',
  operations: [
    { action: 'replace', id: 'input-reader', expected_hash: base.data.hashes['input-reader'], content: 'import json\n\ndef read_input():\n    with open("input.json") as stream:\n        return json.load(stream)\n' },
    { action: 'replace_section', id: 'input-guide', expected_hash: base.data.hashes['input-guide'], section_id: 'protocol', content: 'Read a UTF-8 JSON object from input.json with json.load. Invalid JSON raises an error.' }
  ]
});
console.log('PREPARED', JSON.stringify({ id: prepared.id, candidate: prepared.candidate, diff: prepared.diffs }, null, 2));
console.log('APPLIED', await w.apply(prepared.id));
console.log('NEEDS REVIEW', JSON.stringify(await w.list({ needs_review: true }), null, 2));
console.log('EXPORTED', await w.exportSnapshot(path.join(root, 'export')));
console.log(`MCP: node dist/cli.js --state ${w.root} mcp`);
