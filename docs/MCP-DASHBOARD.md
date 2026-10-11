---
title: MCP Dashboard — Historical Snapshot
status: historical
tags: [historical, mcp]
updated: 2026-08-04
---

> **Historical snapshot (2026-06-27).** Live MCP/credential status:
> [`MCP-REFERENCE.md`](MCP-REFERENCE.md). Counts below are retained for
> context only and must not be treated as current.

# MCP Dashboard — Historical Snapshot

**Last updated:** 2026-06-27  
**Total Servers:** 24 | **Working:** 9 | **Pending:** 14 | **Paused:** 2

---

## ✅ Working MCP Servers (9)

| Server | Capabilities | Verified |
|--------|--------------|----------|
| **github** | 124 repos, PRs, issues, code search | ✅ |
| **notion** | Workspace "Main", pages, databases, content | ✅ |
| **supabase** | 5 projects, DB management | ✅ |
| **stripe** | Payments, customers, account (Bookchaowalit) | ✅ |
| **vercel** | 20+ projects, deployments, build logs | ✅ |
| **cloudflare** | DNS records, Workers, zone analytics | ✅ |
| **leantime** | Nexatech PM — 17 tools, 20 projects | ✅ |
| **firecrawl** | Web scraping, crawling, search (⚠️ Deprecated in scripts — replaced with httpx+BS4) | ✅ |
| **infisical** | Secret vault, Solo Empire project (13 folders) | ⚠️ Needs restart |

---

## ⏳ Pending Setup (5 — need credentials)

| Server | What's Missing |
|--------|---------------|
| **atlassian** | Email + Instance URL (API token ✅) |
| **google-analytics** | Service account JSON + GCP project ID |
| **trello** | API Key + API Token |
| **cloudinary** | Cloudinary URL |
| **digitalocean** | API Token |

## ⏸ Paused Integrations

| Server | Status |
|--------|--------|
| **strava** | Intentionally paused; credentials are not loaded |
| **binance-th** | Intentionally paused; credentials are not loaded |

---

## 🔧 Utility Servers (9)

| Server | Purpose | Status |
|--------|---------|--------|
| **playwright** | Browser automation | Needs Chrome |
| **context7** | Library docs lookup | Configured |
| **fetch** | Web content fetching | Configured |
| **postgres** | PostgreSQL queries | Placeholder URL |
| **redis** | Redis operations | Placeholder URL |
| **azure** | Azure services | No auth |
| **canva** | Design tool | Tool not found |
| **google** | Gmail/Calendar/Drive (custom bridge) | Custom setup |
| **sequential-thinking** | Complex reasoning | Configured |

---

## 🔐 Credential Management

**Primary vault:** Infisical → Solo Empire project  
**Project ID:** `d0d84520-c3d0-48da-980c-a987c3077122`  
**Folders:** 13 | **Secrets:** 22 (10 live, 12 placeholder)

**Config file:** `~/.config/Qoder/SharedClientCache/mcp.json`

---

## 📊 Stats

| Metric | Value |
|--------|-------|
| Total MCP Servers | 24 |
| Working | 9 |
| Needs Restart | 1 (Infisical) |
| Need Credentials | 6 |
| Utility/Other | 9 |
| Infisical Secret Folders | 13 |
| Infisical Total Secrets | 22 |
| GitHub Repos | 124 |
| Vercel Projects | 20+ |
| Supabase Projects | 5 |
| Leantime Projects | 20 |

---

## 🎯 Next Steps

1. **Restart Qoder** — fixes Infisical broken pipe
2. **Add Atlassian email + URL** — activates Jira/Confluence integration
3. **Add remaining credentials** — Trello, Google Analytics, Cloudinary, DigitalOcean (Strava is intentionally paused)
4. **Use working MCPs** — GitHub, Notion, Supabase, Stripe, Vercel, Cloudflare, Leantime, Infisical
5. **Note:** Firecrawl MCP still available for AI agents, but all automation scripts now use free httpx+BS4 scraper (migrated June 27, 2026)

---

**Status:** 9/24 working | Last updated: 2026-06-27
