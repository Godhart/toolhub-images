# ADR-0005: Pin VUnit to stable 4.7.1

Status: accepted

## Context

VUnit 5.x is still a development/pre-release line. The current stable PyPI release is 4.7.1.
`hdl-order` relies on the public VUnit UI for source registration, manual dependencies and
compile-order calculation.

## Decision

Version 0.4.1 pins `vunit_hdl==4.7.1` for reproducible behavior. The integration is limited to
public API concepts used by 4.7.1: `VUnit.from_argv`, `add_library`, `Library.add_source_file`
(with `include_dirs`, `defines`, and `file_type`), `SourceFile.add_dependency_on`,
`VUnit.get_compile_order`, and `SourceFile.name/library`.

## Consequences

Development releases of VUnit 5 are not selected implicitly. Supporting VUnit 5 will be a
separate compatibility decision after a stable 5.x release exists and the test suite passes.
