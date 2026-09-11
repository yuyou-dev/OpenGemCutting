# Facet 96 Local MCP

Optional stdio adapter for the same-source Facet 96 workbench. Requires a built application from this checkout, Node 20.19+ or 22.12+, and `npm ci --prefix mcp`. No model-specific SDK or API key is required by this server.

- `server.mjs`: standard MCP tools/resources/prompts; imports the shared application contract.
- `host.mjs`: loopback static workbench, authenticated page bridge, isolated sessions and temporary PDF delivery.
- `register-codex.mjs`: legacy alias to the complete `setup/cli.mjs` installer; direct stdio clients do not need this entry.
- `tests/`: transport/isolation regression tests. Application behavior tests live in `src/application/` and the existing domain tests.

Start with [the guide](../docs/mcp/README.md), [architecture](../docs/mcp/architecture.md) and [examples](../docs/mcp/examples.md). The root frontend install/build never needs this package. This adapter ships alongside application source, not as a separately forked geometry implementation.
