# hdl-order

`hdl-order` determines HDL compilation order for projects containing VHDL, Verilog and SystemVerilog sources split across multiple libraries. It also reports design units, Verilog/SystemVerilog include relationships, explicit dependencies, and a lightweight library-qualified design-unit graph.

Version **0.7.0** targets the stable **VUnit 4.7.1** API and pins `vunit_hdl==4.7.1`.

## TWYLT tools (0.7.0)

Eight ready-to-run tools are included in `tools/`. Install `.[twylt]` and see
[docs/TWYLT.md](docs/TWYLT.md) for toolhub, input/output schemas, examples and local wheel installation.
The ordinary `hdl-order` CLI remains available without the optional TWYLT extra.

## What it is for

The project layout is intentionally simple: each immediate subdirectory of the project root is an HDL library, and the directory name is the library name. Compilation order is calculated at **file level**, so it may interleave libraries; there is no assumption that one whole library must be compiled before another.

For example:

```text
rtl/
├── lib_a/
│   ├── a_pkg.vhd
│   └── top.sv
├── lib_b/
│   ├── b_pkg.vhd
│   └── worker.sv
└── include/
    └── common.svh
```

A single HDL file may contain multiple design units. `hdl-order` keeps the mapping between each library-qualified unit and its source file.

## Installation

Python 3.11 or newer is required.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

For development and tests:

```bash
python -m pip install -r requirements-test.txt
python -m pytest -v
```

or simply:

```bash
./run-tests.sh
```

## Quick start

Show compilation order:

```bash
hdl-order rtl
```

Typical output:

```text
0001 lib_a                lib_a/a_pkg.vhd
0002 lib_b                lib_b/b_pkg.vhd
0003 lib_a                lib_a/top.sv
```

Check the project for duplicate design units and dependency-analysis errors:

```bash
hdl-order rtl --check
```

Inspect the design units found in the project:

```bash
hdl-order rtl --symbols
```

## Command-line reference and examples

The general form is:

```text
hdl-order ROOT [options]
```

Report options `--check`, `--symbols`, `--unit-map`, `--unit-graph`, `--deps`, `--headers`, and `--explain` are mutually exclusive. Without one of them, `hdl-order` prints the compilation order using `--format`.

### `ROOT` — project root

`ROOT` is the directory whose immediate child directories are HDL libraries.

```bash
hdl-order ./rtl
```

Here `rtl/lib_a/...` belongs to library `lib_a`, and `rtl/lib_b/...` belongs to library `lib_b`.

### `-f`, `--format` — compilation-order output format

Available formats are `plain`, `json`, `csv`, and `modelsim`. The default is `plain`.

```bash
hdl-order rtl --format plain
hdl-order rtl --format json
hdl-order rtl --format csv
hdl-order rtl --format modelsim
```

The ModelSim format emits `vlib`/`vmap` plus `vcom`/`vlog` commands in calculated order:

```bash
hdl-order rtl --format modelsim > compile.do
```

`--format` applies to the normal compilation-order report. Unit maps and unit graphs have their own format options described below.

### `-c`, `--config` — explicit dependency configuration

Use a TOML file for dependencies that cannot or should not be inferred automatically:

```bash
hdl-order rtl --config hdl-order.toml
```

Example `hdl-order.toml`:

```toml
[[dependency]]
file = "lib_a/a_impl.vhd"
depends_on = "lib_b/b_pkg.vhd"
reason = "generated interface dependency"
```

This means `lib_b/b_pkg.vhd` must be compiled before `lib_a/a_impl.vhd`.

### `-I`, `--include` — add an include search directory

The option may be repeated:

```bash
hdl-order rtl -I rtl/include -I generated/include
```

It is used when resolving Verilog/SystemVerilog `` `include `` directives and is also passed to VUnit for Verilog/SystemVerilog sources.

### `-D`, `--define` — define a preprocessor macro

A macro may be defined without a value or with a value. The option may be repeated:

```bash
hdl-order rtl -D FPGA_BUILD -D DATA_WIDTH=32
```

These definitions are used by the lightweight Verilog/SystemVerilog preprocessor and passed to VUnit.

### `--allow-missing-includes` — tolerate unresolved includes

By default an unresolved `` `include `` is an error. To continue analysis while retaining the unresolved include in dependency reports:

```bash
hdl-order rtl --allow-missing-includes
```

This is useful for incomplete source trees or headers supplied later by an external build environment.

### `--check` — run project checks

```bash
hdl-order rtl --check
```

On success, the report summarizes compilation units, design units and headers. Duplicate design units make the check fail with exit status 1. Analysis errors such as unresolved includes or semantic dependency failures return exit status 2.

### `--symbols` — list discovered design units

```bash
hdl-order rtl --symbols
```

The report includes library, unit kind, name, source file and line. VHDL names are normalized case-insensitively. Multiple design units in one source file are supported.

### `--unit-map` — map design units to source files

Text output:

```bash
hdl-order rtl --unit-map
```

JSON output:

```bash
hdl-order rtl --unit-map --map-format json
```

A unit identity includes its library and kind, for example:

```text
lib_a::package::config_pkg       -> lib_a/blocks.sv:1
lib_a::module::producer          -> lib_a/blocks.sv:18
lib_a::module::consumer          -> lib_a/blocks.sv:42
```

### `--map-format` — choose unit-map format

Available values are `text` and `json`; default is `text`.

```bash
hdl-order rtl --unit-map --map-format text
hdl-order rtl --unit-map --map-format json > units.json
```

This option is meaningful together with `--unit-map`.

### `--unit-graph` — show the design-unit dependency graph

```bash
hdl-order rtl --unit-graph
```

The graph uses library-qualified design units and typed dependency edges, for example `uses`, `imports`, `references-package`, `architecture-of`, and `package-body-of` where the lightweight frontend can determine them.

### `--graph-format` — choose unit-graph format

Available values are `text`, `json`, and Graphviz `dot`; default is `text`.

```bash
hdl-order rtl --unit-graph --graph-format text
hdl-order rtl --unit-graph --graph-format json > graph.json
hdl-order rtl --unit-graph --graph-format dot > graph.dot
```

A DOT file can then be rendered by Graphviz, for example:

```bash
dot -Tsvg graph.dot -o graph.svg
```

This option is meaningful together with `--unit-graph`.

### `--deps` — show dependencies visible directly to hdl-order

```bash
hdl-order rtl --deps
```

The report currently contains two groups: Verilog/SystemVerilog include edges and explicit compile dependencies from the TOML configuration. It is **not** a dump of every internal semantic edge detected by VUnit.

### `--headers` — show headers and their users

```bash
hdl-order rtl --headers
```

The report lists discovered `.vh`/`.svh` headers and compilation units that depend on them transitively.

### `--explain FILE` — explain dependencies of one file

```bash
hdl-order rtl --explain lib_a/top.sv
```

Example shape:

```text
lib_a/top.sv
└─ include include/defs.svh -> lib_a/include/defs.svh
   └─ include widths.vh -> lib_a/include/widths.vh
```

Explicit dependencies originating from the selected file are also shown. `--explain` currently explains hdl-order-visible include and explicit dependencies; it does not expose all internal VUnit semantic edges.

### `-h`, `--help` — show CLI help

```bash
hdl-order --help
```

## Common workflows

To inspect a new project, a useful sequence is:

```bash
hdl-order rtl --check
hdl-order rtl --symbols
hdl-order rtl --unit-map
hdl-order rtl --unit-graph
hdl-order rtl
```

For a SystemVerilog project with external headers and build macros:

```bash
hdl-order rtl \
  -I rtl/include \
  -I generated/include \
  -D FPGA_BUILD \
  -D DATA_WIDTH=32 \
  --check
```

To generate machine-readable artifacts:

```bash
hdl-order rtl --format json > compile-order.json
hdl-order rtl --unit-map --map-format json > unit-map.json
hdl-order rtl --unit-graph --graph-format json > unit-graph.json
```

## Supported source model

Compilation units are discovered recursively below each immediate library directory:

- VHDL: `.vhd`, `.vhdl`
- Verilog: `.v`
- SystemVerilog: `.sv`

Verilog/SystemVerilog headers `.vh` and `.svh` are dependency inputs, not standalone compilation units.

The 0.5.0 frontend uses a source-location-preserving token lexer for design-unit discovery. Whitespace, unusual line splitting and comments are therefore not treated as statement boundaries. Strings are opaque to unit discovery, so keywords inside strings/comments do not create false design units.

## Important limitations

`hdl-order` deliberately does not implement complete IEEE VHDL or SystemVerilog parsers. The token-based frontend is intended for dependency analysis and is conservative around constructs it cannot identify safely. VUnit 4.7.1 remains responsible for semantic file compilation ordering.

The design-unit graph is therefore useful for inspection and explanation but should not yet be interpreted as a complete elaboration graph. Conditional compilation, advanced macro expansion, unusual language constructs and name-resolution rules can require further frontend work.

## Architecture

The main layers are:

```text
HDL sources
    │
    ├── SV preprocessor / include analysis
    │
    ├── token-based lightweight HDL frontend
    │       └── design units + lightweight unit edges
    │
    ├── explicit TOML dependencies
    │
    └── VUnitAdapter
            └── VUnit HDL 4.7.1 semantic compile ordering
```

Architectural decisions are recorded in `docs/adr/`. In particular, ADR-0006 isolates the VUnit 4.7.1 API behind an adapter, and ADR-0007 records the move from physical-line regex matching to token-based HDL frontends.

## Tests

Run the complete regression suite with:

```bash
./run-tests.sh
```

See `TESTING.md` for additional details. Version 0.4.2 is the previously verified baseline; 0.5.0 adds frontend robustness tests for non-standard line splitting, comments, strings and source locations.

## License

MIT.


## Dependency manifest export (0.6.0)

```bash
hdl-order rtl --export-dependencies dependencies.json --dependency-format manifest-v1 --project-id fpga-demo --analysis-profile default
```

The positional path follows the same library layout as existing analysis modes.
The export is JSON conforming to `schemas/dependency-manifest.schema.json`.
`--project-id` is required for export; `--analysis-profile` defaults to `default`.
Source root `rtl` maps to the analyzed project; additional external include roots
have logical names `include-N`. Consumers explicitly map these names to their repositories.
Paths are relative; byte hashes are SHA-256. Git revision, where available, is advisory.

Edges say **dependent depends on dependency**. File nodes and library-qualified
symbol nodes are separate; symbol nodes retain their containing file. Compilation
order is not converted into dependency edges. Definitions, include search order,
and explicit dependencies are recorded in the analysis configuration.

This exporter deliberately reports `coverage.status: partial`: symbol edges come
from syntactic observations, not the complete VUnit semantic dependency graph.
Unresolved references can be absent. A consumer must not interpret an omitted
edge as proof that a dependency has disappeared. Input changes detected between
capture and export abort the report. This is a consistency check, not a filesystem lock.

Install the extra test dependency and run the accumulated test suite:

```bash
python -m pip install -e '.[test]'
python -m pytest -q
```

See `ADR-0.6.md` for format decisions and `CHANGELOG-0.6.md` for release checks.
