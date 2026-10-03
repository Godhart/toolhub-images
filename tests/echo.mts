import {Type, defineTool} from '@twylt/core';
const tool = defineTool({
  name:'smoke-echo',version:'1',description:'Container import and transport test',
  inputSchema:Type.Object({text:Type.String()}),
  outputSchema:Type.Object({text:Type.String()}),
  biz: async ({text}) => ({text}),
});
process.exitCode = await tool.run();
