# ToolHub configuration loader integration

Integrated from toolhub-config-loader-0.1.1 prepared on 2026-10-04.
The loader had no accessible published GitHub repository when integrated.
Only its Python package, schema, license, relevant regression tests and the REMOTE
identity fix are kept here (no ToolHub source copy). This module is now part of
ToolHub Images; it can move to a pinned GitHub dependency once published.

CLI: toolhub-config validate/check/apply/serve --config FILE [...].
`mode: reset` backs up the existing database and transactionally clears its
settings, runners, tools, categories and audit logs before applying the config.
`mode: merge` updates declared records and keeps undeclared entries.
The domain generator selects the mode with options.reset_settings.

MCP-to-worker configuration is deliberately not generated in this release.
The MCP argv patch from the original loader bundle is not applied here.
