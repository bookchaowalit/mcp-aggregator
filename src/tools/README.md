# MCP Tool Modules

The MCP server keeps transport, database lifecycle, and shared runtime setup in
`src/index.ts`. Tool registrations are grouped by domain here so a new tool can
be added without making the server entrypoint larger.

`free-images.ts` registers official-API stock intake (`list_free_images`,
`fetch_free_images`). It never scrapes HTML.

`seo-report.ts` registers the Pixiu Watch monthly pack CLI
(`seo_report_status`, `seo_monthly_report`). It never crawls the live site,
never sends the client report, and never invents GA4 numbers.

Each module exports one `register*Tools(context)` function. The public tool name,
description, schema, and response contract must remain backward compatible unless
the MCP version is intentionally changed.
