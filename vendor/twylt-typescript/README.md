# TWYLT TypeScript 0.1.0

TypeScript/Node.js 22 implementation of the language-independent **TWYLT 1.8** executable-tool protocol.

> Status: first implementation. The Python `twylt` package remains the reference implementation; this project targets protocol interoperability.

## Design

- Node.js 22+
- ESM
- TypeBox for JSON Schema + inferred TypeScript types
- Ajv for runtime input/output validation
- recursively closed object contracts (`additionalProperties: false`)
- TWYLT transports: CLI JSON -> stdin JSON -> `input.json`
- describe: `brief`, `schema`, `requirements`, `few_shots`, `json_spec`
- JSON errors by default; human errors optional
- exit codes 2=input, 3=output, 4=protocol/transport/describe, 5=business

## Install / development

```sh
npm install
npm test
npm run build
```

## Tool example

```ts
import { Type, defineTool } from '@twylt/core';

const Input = Type.Object({ text: Type.String() });
const Output = Type.Object({ text: Type.String() });

const tool = defineTool({
  name: 'echo',
  version: '1.0.0',
  description: 'Return the supplied text.',
  inputSchema: Input,
  outputSchema: Output,
  biz: ({ text }) => ({ text }),
});

process.exitCode = await tool.run();
```

The schemas are both the runtime contract and the source of TypeScript types for `biz`.

## Discovery

```sh
node tool.js '{"describe":"json_spec"}'
INPUT_DESCRIBE=requirements node tool.js
node tool.js --help
node tool.js --version
node tool.js -v
```

For TypeScript tools, requirements metadata defaults to `npm` / `package.json`. A tool should normally provide explicit `requirements.content` describing what a launcher must install.

## Important stdin behavior

TWYLT gives non-empty stdin precedence over `input.json`. Node therefore waits for EOF when stdin is a pipe. A launcher that opens stdin but neither writes nor closes it can keep a tool waiting. This is protocol/transport behavior, not solved with an arbitrary timeout in the library; launchers should close stdin when no stdin payload is supplied.

## Dependency-independent discovery

Keep optional/business dependencies out of module top-level initialization when they may be absent during discovery. Prefer dynamic imports inside `biz()`. This makes `requirements` and other metadata available without loading optional business dependencies. A future bootstrap layer can add static metadata extraction if cross-language conformance requires it.

## Compatibility scope

This release implements the core TWYLT 1.8 runtime contract. The next useful step is a language-independent conformance fixture suite shared with the Python implementation, especially for exact error issue normalization and dependency-independent `json_spec` fallback behavior.
