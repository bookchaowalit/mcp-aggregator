# MCP Tool Modules

The MCP server keeps transport, database lifecycle, and shared runtime setup in
`src/index.ts`. Tool registrations are grouped by domain here so a new tool can
be added without making the server entrypoint larger.

Each module exports one `register*Tools(context)` function. The public tool name,
description, schema, and response contract must remain backward compatible unless
the MCP version is intentionally changed.
