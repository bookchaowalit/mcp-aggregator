---
title: MCP Quick Reference Card
status: current
tags: [current, mcp]
updated: 2026-08-04
---

> **Canonical live MCP/credential status.** Prefer this file over historical MCP snapshots.

# MCP Quick Reference Card

**Last updated:** 2026-06-29  
**Status:** ✅ 10 Working | ⏳ 5 Pending Credentials | ⏸ 2 Paused | 🔧 8 Utility

---

## 🔧 MCP Server Status (24 Total)

### ✅ Working (9)

| Server | Package | Details |
|--------|---------|---------|
| **github** | `@modelcontextprotocol/server-github` | 124 repos, PRs, issues, code search |
| **notion** | `@notionhq/notion-mcp-server@latest` | Workspace "Main", pages, databases |
| **supabase** | `@supabase/mcp-server-supabase@latest` | 5 projects, DB management |
| **stripe** | `@stripe/mcp@latest` | Account: Bookchaowalit, payments |
| **vercel** | Custom bridge (`vercel-mcp-bridge`) | 20+ projects, deployments, logs |
| **cloudflare** | `@cloudflare/mcp-server-cloudflare@latest` | DNS, Workers, analytics |
| **leantime** | Remote HTTP (cocofriday.com) | Nexatech PM, 17 tools, 20 projects |
| **firecrawl** | `firecrawl-mcp` | Web scraping, crawling, search (⚠️ Deprecated in scripts — replaced with httpx+BS4) |
| **infisical** | `@infisical/mcp` | Secret vault, Solo Empire project (needs restart) |
| **google** | Custom bridge (`google-mcp-bridge`) | ✅ Gmail, Calendar, Drive, Contacts — OAuth verified 2026-06-29 |

### ⏳ Pending Credentials (5)

| Server | Package | Missing |
|--------|---------|---------|
| **atlassian** | `@anthropic/mcp-atlassian@latest` | Email + Instance URL (token ✅) |
| **google-analytics** | `analytics-mcp` (uvx) | Service account JSON path + GCP project ID |
| **trello** | `@delorenj/mcp-server-trello` | API Key + API Token |
| **cloudinary** | `@cloudinary/asset-management-mcp@latest` | Cloudinary URL |
| **digitalocean** | `@digitalocean/mcp` | API Token |

### ⏸ Paused Integrations

| Server | Status |
|--------|--------|
| **strava** | Intentionally paused; historical records and configuration are retained, but credentials are not loaded |
| **binance-th** | Intentionally paused; historical records and sync code are retained, but credentials are not loaded |

### 🔧 Utility / Other (9)

| Server | Package | Status |
|--------|---------|--------|
| **playwright** | `@playwright/mcp@latest` | Needs Chrome installed |
| **context7** | `@upstash/context7-mcp@latest` | Library docs lookup |
| **fetch** | `mcp-server-fetch` (uvx) | Web content fetching |
| **postgres** | `@modelcontextprotocol/server-postgres` | Placeholder localhost URL |
| **redis** | `@modelcontextprotocol/server-redis` | Placeholder URL |
| **azure** | `@azure/mcp` | No auth configured |
| **canva** | `@canva/cli@latest` | Tool not found on startup |
| **sequential-thinking** | `@modelcontextprotocol/server-sequential-thinking` | Reasoning tool |

---

## 🔐 Credentials Vault

All live credentials stored in **Infisical** → Solo Empire project (`d0d84520-c3d0-48da-980c-a987c3077122`)

| Folder | Secrets | Status |
|--------|---------|--------|
| `/github` | GITHUB_PERSONAL_ACCESS_TOKEN | ✅ Live |
| `/notion` | NOTION_BOT_TOKEN | ✅ Live |
| `/supabase` | SUPABASE_ACCESS_TOKEN | ✅ Live |
| `/cloudflare` | CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID | ✅ Live |
| `/stripe` | STRIPE_SECRET_KEY | ✅ Live |
| `/infisical` | INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET | ✅ Live |
| `/firecrawl` | FIRECRAWL_API_KEY | ✅ Live |
| `/atlassian` | ATLASSIAN_API_TOKEN, ATLASSIAN_EMAIL, ATLASSIAN_INSTANCE_URL | ⚠️ Partial |
| `/strava` | STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET | ⏸ Paused — not loaded |
| `/trello` | TRELLO_API_KEY, TRELLO_API_TOKEN | 🔲 Placeholder |
| `/google-analytics` | GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_PROJECT_ID | 🔲 Placeholder |
| `/cloudinary` | CLOUDINARY_URL | 🔲 Placeholder |
| `/digitalocean` | DIGITALOCEAN_API_TOKEN | 🔲 Placeholder |

**Config file:** `~/.config/Qoder/SharedClientCache/mcp.json`

---

## 🚀 Quick Commands

### GitHub

| What | Say to Qoder |
|------|--------------|
| My repos | "List my GitHub repositories" |
| Recent PRs | "Show my recent pull requests" |
| Search code | "Search for [function] in my repos" |
| Issues | "Show open issues in [repo-name]" |

### Vercel

| What | Say to Qoder |
|------|--------------|
| Projects | "List my Vercel projects" |
| Deployments | "Show recent deployments for [project]" |
| Build logs | "Check build logs for [deployment]" |

### Cloudflare

| What | Say to Qoder |
|------|--------------|
| DNS records | "Show DNS records for [domain]" |
| Workers | "List my Cloudflare Workers" |

### Stripe

| What | Say to Qoder |
|------|--------------|
| Account | "Show my Stripe account info" |
| Payments | "List recent Stripe payments" |
| Customers | "Show Stripe customers" |

### Notion

| What | Say to Qoder |
|------|--------------|
| Search | "Search Notion for [topic]" |
| Pages | "List my Notion pages" |
| Read | "Read the Notion page called [name]" |

### Supabase

| What | Say to Qoder |
|------|--------------|
| Projects | "List my Supabase projects" |
| Tables | "Show tables in [project]" |

### Firecrawl

| What | Say to Qoder |
|------|--------------|
| Search web | "Search the web for [topic] using Firecrawl" |
| Scrape | "Scrape [url] using Firecrawl" |
| Crawl | "Crawl [url] with Firecrawl" |

**Note:** Firecrawl MCP still available for AI agents, but all automation scripts migrated to free httpx+BS4 scraper on June 27, 2026.

### Infisical

| What | Say to Qoder |
|------|--------------|
| List projects | "List Infisical projects" |
| List secrets | "List secrets from Solo Empire project" |
| Read secret | "Get [secret] from Infisical" |

### Google

| What | Say to Qoder |
|------|--------------|
| Calendar events | "Show my Google Calendar events for today" |
| Search email | "Search Gmail for [topic]" |
| Drive files | "List my Google Drive files" |
| Read email | "Read the email with ID [id]" |

**Note:** OAuth tokens stored at `~/.config/google-mcp-tokens.json`. If `invalid_grant` error occurs, re-run `node ~/google-mcp-bridge/auth.mjs` and complete browser sign-in.

### Leantime

| What | Say to Qoder |
|------|--------------|
| Projects | "List Leantime projects" |
| Tasks | "Show tasks for [project]" |
| Create task | "Create a Leantime task: [title]" |

---

## 🔐 Infisical Secrets Inventory

**Project:** Solo Empire  
**Project ID:** `d0d84520-c3d0-48da-980c-a987c3077122`  
**Environment:** `dev` (primary)  
**Machine Identity:** `bookchaowalit` (Admin)

### Secret Folders & Keys

| Folder Path | Secret Keys | Status |
|-------------|-------------|--------|
| `/cloudflare` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | ✅ Live |
| `/stripe` | `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` | ✅ Live |
| `/notion` | `NOTION_API_KEY`, `NOTION_API_TOKEN`, `NOTION_VERSION` | ✅ Live |
| `/github` | `GITHUB_PERSONAL_ACCESS_TOKEN` | ✅ Live |
| `/supabase` | `SUPABASE_ACCESS_TOKEN` | ✅ Live |
| `/firecrawl` | `FIRECRAWL_API_KEY` | ✅ Live |
| `/infisical` | `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID`, `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET` | ✅ Live |
| `/vercel` | `VERCEL_TOKEN` | ✅ Live |
| `/telegram` | `TELEGRAM_TRADING_BOT_TOKEN`, `TELEGRAM_INFRA_BOT_TOKEN`, `TELEGRAM_HEALTH_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | ✅ Live |
| `/todoist` | `TODOIST_API_TOKEN` | ✅ Live |
| `/posthog` | `POSTHOG_API_KEY` | 🔲 Placeholder — read-only `insight:read` key pending |
| `/sentry` | `SENTRY_AUTH_TOKEN` | 🔲 Placeholder — read-only organization access pending |
| `/slack` | `SLACK_BOT_TOKEN` | 🔲 Placeholder — read-only `channels:read` token pending |
| `/asana` | `ASANA_PERSONAL_ACCESS_TOKEN` | 🔲 Placeholder — read-only `workspaces:read`/`projects:read` token pending |
| `/database` | `TRADING_DATABASE_URL` | ✅ Live |
| `/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID_ALT`, `GOOGLE_CLIENT_SECRET_ALT` | ✅ Live |
| `/digitalocean` | `DIGITALOCEAN_API_TOKEN` | ⚠️ Placeholder |
| `/google-analytics` | `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_PROJECT_ID` | ⚠️ Placeholder |
| `/strava` | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | ⏸ Paused — not loaded |

### Not in Infisical (external config or pending)

- **Leantime** — Remote MCP server at `mcp.project.cocofriday.com`, auth handled by the remote endpoint (no local API key)
- **Jira** — Pending setup (commented out in `.env`)
- **OpenRouter** — Empty value in `.env` (not yet configured)
- **GitHub Token** — Empty in `.env`; GitHub MCP uses `GITHUB_PERSONAL_ACCESS_TOKEN` from `/github` folder instead

### Related Project

**BookFinance Trading** (ID: `65cc2f7f-4e1d-4123-aa06-5978ccaae861`)  
Folder: `/trading` — `BINANCE_FUTURES_API_KEY` and
`BINANCE_FUTURES_API_SECRET` are the Futures Demo/Testnet names. Resolve them
only for the nested BookFinance strategy runtime. Binance TH remains paused,
and no trading credential is loaded into the general Solo Empire runtime.

---

## 💡 Tips

1. **Be specific** — "Show Stripe payments from last week" works better than "show payments"
2. **Chain requests** — "Check Vercel deployments and report any failed builds"
3. **Combine MCPs** — "Search GitHub for [topic] and save results to Notion"
4. **Infisical first** — Use Infisical to retrieve any stored credential before configuring a new MCP

---

**Need help?** Just ask Qoder what you want to do in plain English!  
**Last updated:** 2026-06-29
