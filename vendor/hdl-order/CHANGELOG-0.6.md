# hdl-order 0.6.0

- Added --export-dependencies, --dependency-format manifest-v1, --project-id and --analysis-profile.
- Common dependency-manifest 1.0 with explicit dependent/dependency roles.
- Logical roots, relative paths, byte hashes, symbol containment and evidence.
- Analysis configuration and partial coverage are explicit; compilation order does not fabricate graph edges.
- Existing reports retained. Accumulated tests: 49 passed, 1 expected failure.
- Editable installation and cross-language import into OKF Workspace 0.2.0 verified.

The export remains syntactic and partial. It is not a complete VUnit semantic graph.
