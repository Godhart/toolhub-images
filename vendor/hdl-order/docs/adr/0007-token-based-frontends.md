# ADR-0007: Token-based lightweight HDL frontends
Status: accepted

Line-oriented regular expressions are not a reliable basis for HDL design-unit discovery.
Starting with 0.5.0, design-unit discovery consumes a token stream with source locations.
Whitespace and comments are discarded lexically and strings remain opaque, so formatting
and end-of-line comments do not create parser semantics.

This is intentionally not a complete IEEE parser. The frontend remains replaceable so a
future GHDL/Surelog/tree-sitter implementation can reuse the graph model and CLI.
