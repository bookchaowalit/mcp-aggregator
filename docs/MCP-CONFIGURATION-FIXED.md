---
title: MCP Configuration Fixed Notes
tags: [mcp, historical, troubleshooting]
created: 2026-06-27
updated: 2026-08-04
status: historical
description: Point-in-time MCP configuration troubleshooting notes; use MCP-REFERENCE for live status
---

# MCP Server Configuration

**Date:** 2026-06-27  
**Config file:** `~/.config/Qoder/SharedClientCache/mcp.json`  
**Total servers:** 24

> **Historical.** Verify live credentials and status in
> [`MCP-REFERENCE.md`](MCP-REFERENCE.md). Do not treat server counts below as current.

---

## Snapshot status (2026-06-27)

| Category | Count | Servers |
|----------|-------|---------|
| ✅ Working | 9 | github, notion, supabase, stripe, vercel, cloudflare, leantime, firecrawl, infisical |
| ⏳ Need credentials | 5 | atlassian, google-analytics, trello, cloudinary, digitalocean |
| ⏸ Paused | 1 | strava (historical configuration retained; credentials not loaded) |
| 🔧 Utility/Other | 9 | playwright, context7, fetch, postgres, redis, azure, canva, google, sequential-thinking |

---

## Working Servers — Configuration

### GitHub
```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "***" }
  }
}
```

### Notion
```json
{
  "notion": {
    "command": "npx",
    "args": ["-y", "@notionhq/notion-mcp-server@latest"],
    "env": { "OPENAPI_MCP_HEADERS": "{\"Authorization\":\"Bearer ***\",\"Notion-Version\":\"2022-06-28\"}" }
  }
}
```

### Supabase
```json
{
  "supabase": {
    "command": "npx",
    "args": ["-y", "@supabase/mcp-server-supabase@latest"],
    "env": { "SUPABASE_ACCESS_TOKEN": "***" }
  }
}
```

### Stripe
```json
{
  "stripe": {
    "command": "npx",
    "args": ["-y", "@stripe/mcp@latest"],
    "env": { "STRIPE_SECRET_KEY": "***" }
  }
}
```

### Vercel (Custom Bridge)
```json
{
  "vercel": {
    "command": "node",
    "args": ["/home/bookchaowalit/vercel-mcp-bridge/server.mjs"]
  }
}
```

### Cloudflare
```json
{
  "cloudflare": {
    "command": "npx",
    "args": ["-y", "@cloudflare/mcp-server-cloudflare@latest", "run", "98e152b05e32b75612ee03e955913ee2"],
    "env": {
      "CLOUDFLARE_API_TOKEN": "***",
      "CLOUDFLARE_ACCOUNT_ID": "98e152b05e32b75612ee03e955913ee2"
    }
  }
}
```

### Leantime (Remote HTTP)
```json
{
  "leantime": {
    "url": "https://mcp.project.cocofriday.com/mcp"
  }
}
```

### Firecrawl
```json
{
  "firecrawl": {
    "command": "npx",
    "args": ["-y", "firecrawl-mcp"],
    "env": { "FIRECRAWL_API_KEY": "***" }
  }
}
```
**Note:** Firecrawl MCP server still available for AI agents, but all Python automation scripts migrated to free httpx+BS4 scraper on June 27, 2026 to eliminate paid API dependency.

### Infisical
```json
{
  "infisical": {
    "command": "npx",
    "args": ["-y", "@infisical/mcp"],
    "env": {
      "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID": "***",
      "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET": "***",
      "INFISICAL_AUTH_METHOD": "universal-auth"
    }
  }
}
```

---

## Pending — Needs Credentials

### Atlassian (partial — has token)
```json
{
  "atlassian": {
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-atlassian@latest"],
    "env": {
      "ATLASSIAN_API_TOKEN": "***",
      "ATLASSIAN_EMAIL": "REPLACE_WITH_YOUR_EMAIL",
      "ATLASSIAN_INSTANCE_URL": "https://your-domain.atlassian.net"
    }
  }
}
```
**To activate:** Provide your Atlassian email and instance URL (e.g. `https://myteam.atlassian.net`)

### Google Analytics
```json
{
  "google-analytics": {
    "command": "uvx",
    "args": ["analytics-mcp"],
    "env": {
      "GOOGLE_APPLICATION_CREDENTIALS": "REPLACE_WITH_PATH_TO_SERVICE_ACCOUNT_JSON",
      "GOOGLE_PROJECT_ID": "REPLACE_WITH_YOUR_GCP_PROJECT_ID"
    }
  }
}
```

### Strava
```json
{
  "strava": {
    "status": "paused",
    "note": "Intentionally disabled; do not load credentials until explicitly re-enabled.",
    "command": "npx",
    "args": ["-y", "@r-huijts/strava-mcp-server"],
    "env": {
      "STRAVA_CLIENT_ID": "REPLACE_WITH_STRAVA_CLIENT_ID",
      "STRAVA_CLIENT_SECRET": "REPLACE_WITH_STRAVA_CLIENT_SECRET"
    }
  }
}
```

### Trello
```json
{
  "trello": {
    "command": "npx",
    "args": ["-y", "@delorenj/mcp-server-trello"],
    "env": {
      "TRELLO_API_KEY": "REPLACE_WITH_TRELLO_API_KEY",
      "TRELLO_API_TOKEN": "REPLACE_WITH_TRELLO_API_TOKEN"
    }
  }
}
```

### Cloudinary
```json
{
  "cloudinary": {
    "command": "npx",
    "args": ["-y", "@cloudinary/asset-management-mcp@latest"],
    "env": { "CLOUDINARY_URL": "REPLACE_WITH_YOUR_CLOUDINARY_URL" }
  }
}
```

### DigitalOcean
```json
{
  "digitalocean": {
    "command": "npx",
    "args": ["-y", "@digitalocean/mcp", "--services", "apps"],
    "env": { "DIGITALOCEAN_API_TOKEN": "REPLACE_WITH_DIGITALOCEAN_API_TOKEN" }
  }
}
```

---

## Credential Vault

All credentials mirrored in **Infisical → Solo Empire** project:
- **Project ID:** `d0d84520-c3d0-48da-980c-a987c3077122`
- **Folders:** 13 | **Secrets:** 22 (10 live, 12 placeholder)

---

## Troubleshooting

### Infisical broken pipe
Restart Qoder completely. The MCP bridge caches connections at startup.

### Firecrawl 401
Verify `FIRECRAWL_API_KEY` is set in mcp.json. Key: `fc-ca58...`  
**Note:** Firecrawl no longer used in automation scripts — replaced with free httpx+BS4 scraper (June 27, 2026). MCP server still available for AI agents.

### Atlassian 401
Need to provide `ATLASSIAN_EMAIL` and `ATLASSIAN_INSTANCE_URL` in addition to the API token.

### Config not loading
After editing `mcp.json`, restart Qoder for changes to take effect.

---

**Last updated:** 2026-06-27
