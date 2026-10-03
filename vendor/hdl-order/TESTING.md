# Testing hdl-order 0.7.0

## Quick run

```bash
python -m venv .venv
source .venv/bin/activate
./run-tests.sh
```

or manually:

```bash
pip install -e .
pip install -r requirements-test.txt
pytest -v
```

## Coverage of the suite

The tests exercise:

1. VHDL entity/package/package-body/architecture indexing.
2. VHDL case-insensitive duplicate detection.
3. Architecture duplicate key `(library, entity, architecture)`.
4. SV module/interface/package/program indexing and case sensitivity.
5. Same design-unit name in different libraries.
6. Recursive `.vh`/`.svh` includes.
7. `ifdef`, `ifndef`, `elsif`, `else`, `endif`.
8. `define` and `undef`.
9. `-D NAME` and `-D NAME=VALUE` parsing.
10. Simple macro-expanded `include`.
11. Include lookup through `-I`.
12. Missing include handling.
13. Include-cycle detection.
14. Independent macro context for separate compilation units.
15. Cross-library VHDL compile order A -> B -> A.
16. Headers excluded from compilation units.
17. Explicit TOML compile dependencies.
18. Reports: `--check`, `--symbols`, `--deps`, `--headers`, `--explain`.
19. Output formats: plain, JSON, CSV, ModelSim.
20. CLI exit codes.

One test is deliberately marked `xfail`: macro-generated SV design-unit declarations are
a documented 0.3 limitation. It should show as XFAIL, not FAIL.

## Expected result

A healthy 0.3.0 run should end with all normal tests passing and the documented
limitation reported as XFAIL. If any ordinary test fails, preserve the full pytest
traceback; it should identify whether the failure is in hdl-order itself or in an
assumption about the installed VUnit version.


## Release 0.6.0 verification

Python 3.12, VUnit 4.7.1: **49 passed, 1 xfailed**. All previous tests retained.
The expected failure concerns a module generated through SystemVerilog macros.
New tests cover JSON Schema, dependency roles, CLI export, byte-hash consistency,
headers, multiple units per file, analysis configuration and independent profiles,
and the absence of fabricated edges from compilation order.

The editable package built and installed successfully. See `docs/test-output-0.6.txt`.
A separate OKF Workspace 0.2.0 integration test imports a real exported graph.


## Release 0.7.0 verification

Python 3.12, VUnit 4.7.1, TWYLT 1.0.0, Pydantic 2.13.5.
**72 passed, 1 xfailed**. All previous cases retained; 23 wrapper cases added.

New tests execute all eight tools through TWYLT, validate output schemas,
check dependent/dependency roles, stdin/stdout and input.json/output.json,
unknown fields, required project_id, business errors, bootstrap metadata when
hdl_order cannot be imported, renders, include reports and executable few-shots.
The returned manifest is checked against the shared strict JSON Schema 1.0.
The known macro-generated-module limitation remains xfailed.

The built wheel was installed separately; all eight JSON specs were generated
using that installed package. A real HDL project exported by the installed wheel
passed the shared manifest schema. Logs: docs/test-output-0.7.txt.
The user's toolhub/toolpack-builder deployment itself was not accessed.

```bash
python -m pip install '.[test,twylt]'
python -m pytest -q
python scripts/export-twylt-specs.py
```
