import assert from 'node:assert/strict';
import test from 'node:test';
import { Type, defineTool, TWYLT_FORMAT_VERSION } from '../src/index.js';

const Input = Type.Object({ text: Type.String(), nested: Type.Object({ n: Type.Number() }) });
const Output = Type.Object({ text: Type.String() });
const tool = defineTool({ name:'echo', version:'1.0.0', description:'Echo.', inputSchema:Input, outputSchema:Output, biz: ({text}) => ({text}) });

test('json_spec identifies TWYLT 1.8', () => {
  const spec = tool.describe('json_spec') as Record<string, unknown>;
  assert.equal(spec.format_version, TWYLT_FORMAT_VERSION);
  assert.equal(spec.name, 'echo');
});
test('schemas are recursively closed', () => {
  const s = tool.describe('schema') as any;
  assert.equal(s.inputSchema.additionalProperties, false);
  assert.equal(s.inputSchema.properties.nested.additionalProperties, false);
  assert.equal(s.outputSchema.additionalProperties, false);
});
test('valid input executes', async () => assert.deepEqual(await tool.execute({text:'hi', nested:{n:1}}), {text:'hi'}));
test('unknown top-level input field is rejected', async () => assert.rejects(() => tool.execute({text:'hi', nested:{n:1}, extra:true})));
test('unknown nested input field is rejected', async () => assert.rejects(() => tool.execute({text:'hi', nested:{n:1, extra:true}})));
test('invalid output is rejected', async () => {
  const bad = defineTool({ name:'bad', version:'1', description:'bad', inputSchema:Type.Object({}), outputSchema:Type.Object({x:Type.Number()}), biz: () => ({x:'no'} as any) });
  await assert.rejects(() => bad.execute({}));
});
test('business errors are distinct', async () => {
  const bad = defineTool({ name:'bad', version:'1', description:'bad', inputSchema:Type.Object({}), outputSchema:Type.Object({}), biz: () => { throw new Error('boom'); } });
  await assert.rejects(() => bad.execute({}), /boom/);
});
