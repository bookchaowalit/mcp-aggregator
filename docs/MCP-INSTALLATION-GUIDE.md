---
title: MCP Servers Installation Guide
status: current
tags: [current, mcp]
updated: 2026-08-04
---

# MCP Servers Installation Guide

**Date:** 2026-06-27  
**Config:** `~/.config/Qoder/SharedClientCache/mcp.json`  
**Total servers:** 24 (9 working, 1 needs restart, 14 pending)

---

## How MCP Servers Work in Qoder

MCP (Model Context Protocol) servers are configured in `~/.config/Qoder/SharedClientCache/mcp.json`. Each server entry specifies either:

- **stdio transport:** `command` + `args` + optional `env`
- **HTTP/SSE transport:** `url` (for remote servers like Leantime)

After editing the config, **restart Qoder** for changes to take effect.

---

## ✅ Working Servers (9)

| Server | Package | Transport |
|--------|---------|-----------|
| github | `@modelcontextprotocol/server-github` | stdio (npx) |
| notion | `@notionhq/notion-mcp-server@latest` | stdio (npx) |
| supabase | `@supabase/mcp-server-supabase@latest` | stdio (npx) |
| stripe | `@stripe/mcp@latest` | stdio (npx) |
| vercel | Custom bridge | stdio (node) |
| cloudflare | `@cloudflare/mcp-server-cloudflare@latest` | stdio (npx) |
| leantime | Remote HTTP | SSE (url) |
| firecrawl | `firecrawl-mcp` | stdio (npx) | ⚠️ Deprecated in scripts — replaced with httpx+BS4 |
| infisical | `@infisical/mcp` | stdio (npx) |

---

## ⏳ Pending Credentials (6)

| Server | Package | What's Needed |
|--------|---------|---------------|
| atlassian | `@anthropic/mcp-atlassian@latest` | Email + Instance URL |
| google-analytics | `analytics-mcp` (uvx) | Service account JSON + GCP project ID |
| strava | `@r-huijts/strava-mcp-server` | Paused — do not install or enable until explicitly re-enabled |
| trello | `@delorenj/mcp-server-trello` | API Key + API Token |
| cloudinary | `@cloudinary/asset-management-mcp@latest` | Cloudinary URL |
| digitalocean | `@digitalocean/mcp` | API Token |

---

## 🔧 Utility Servers (9)

| Server | Package | Purpose |
|--------|---------|---------|
| playwright | `@playwright/mcp@latest` | Browser automation (needs Chrome) |
| context7 | `@upstash/context7-mcp@latest` | Library docs lookup |
| fetch | `mcp-server-fetch` (uvx) | Web content fetching |
| postgres | `@modelcontextprotocol/server-postgres` | PostgreSQL queries (placeholder URL) |
| redis | `@modelcontextprotocol/server-redis` | Redis operations (placeholder URL) |
| azure | `@azure/mcp` | Azure services |
| canva | `@canva/cli@latest` | Design tool |
| google | Custom bridge (`google-mcp-bridge`) | Gmail/Calendar/Drive |
| sequential-thinking | `@modelcontextprotocol/server-sequential-thinking` | Complex reasoning |

---

## Adding a New MCP Server

1. Find the package name on npm or the MCP registry
2. Add a new entry to `mcp.json` under `mcpServers`:

```json
{
  "my-new-server": {
    "command": "npx",
    "args": ["-y", "@package/name@latest"],
    "env": {
      "API_KEY": "your-key-here"
    }
  }
}
```

3. Save the file
4. Restart Qoder
5. Test by asking Qoder to use the new tools

---

## Credential Management with Infisical

All API credentials are stored in **Infisical → Solo Empire** project:

- **Project ID:** `d0d84520-c3d0-48da-980c-a987c3077122`
- **Auth:** Universal Auth (client ID + secret)
- **Folders:** 13 | **Secrets:** 22

To add a new credential:
1. Create a folder in Infisical (e.g. `/new-service`)
2. Add the secret (e.g. `NEW_SERVICE_API_KEY`)
3. Grant the runtime machine identity read access when a script/cron needs it
4. Configure the runtime provider; do not copy the secret value into `mcp.json`
5. Restart only the MCP client if an interactive agent needs the new path

For local scripts, use the shared resolver documented in
[`systems/cloud-platform/secret-management.md`](../systems/cloud-platform/secret-management.md). MCP is
an agent interface; cron jobs use the Infisical CLI/API or Vault directly.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Broken pipe error | Restart Qoder |
| 401 Unauthorized | Check API key in mcp.json |
| Tool not found | Verify package name, restart Qoder |
| Config not loading | Ensure valid JSON, restart Qoder |
| Chrome not installed | Install Chromium for Playwright MCP |

---

## Related Docs

| File | Purpose |
|------|---------|
| `mcp/MCP-REFERENCE.md` | Quick reference card with commands |
| `mcp/MCP-DASHBOARD.md` | Visual dashboard of all servers |
| `mcp/MCP-CONFIGURATION-FIXED.md` | Full config details for each server |
| `mcp/MCP-LEANTIME.md` | Leantime-specific setup docs |
| `data/generated/reports/mcp-status-report.md` | Detailed status report |

---

**Last updated:** 2026-06-27
