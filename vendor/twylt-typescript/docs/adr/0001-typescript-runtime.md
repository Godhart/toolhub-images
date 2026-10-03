# ADR-0001: TypeScript runtime architecture

Status: Accepted

## Context
TWYLT is language-independent. The TypeScript implementation must preserve the executable protocol while using native TS/Node idioms.

## Decisions
1. Node.js 22 is the minimum runtime.
2. The package is ESM-only.
3. TypeBox schemas are the single source for JSON Schema and TypeScript input/output inference.
4. Ajv performs runtime validation.
5. Object schemas are recursively closed by the TWYLT layer to satisfy protocol 1.4.
6. `defineTool()` is preferred over mirroring Python inheritance.
7. Requirements use npm/package.json semantics by default.
8. stdin is read to EOF; no library timeout is introduced because it would change transport semantics.
9. Protocol version and package version are independent.

## Consequences
Tool authors get compile-time and runtime contracts from one declaration. Exact diagnostic text can differ from Pydantic; interoperability should compare normalized TWYLT issue records rather than validator-native messages where possible.
