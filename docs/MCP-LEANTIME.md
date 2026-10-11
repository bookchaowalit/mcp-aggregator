---
title: Leantime MCP Server — Nexatech Workplace
status: durable
tags: [durable, mcp]
updated: 2026-08-04
---

# Leantime MCP Server — Nexatech Workplace

**Added:** 2026-06-14
**Status:** ✅ Operational
**Transport:** Streamable HTTP (configured as SSE, auto-detected)

---

## Connection Details

| Field | Value |
|-------|-------|
| **Name** | `leantime` |
| **URL** | `https://mcp.project.cocofriday.com/mcp` |
| **Health Check** | `https://mcp.project.cocofriday.com/health` |
| **Auth** | None on MCP protocol (Leantime API key is internal/server-side) |
| **Tools** | 17 tools available |
| **Backend** | Leantime running at `http://leantime:8080` (internal) |

---

## Configuration

This server is configured at the **user level** (global, available across all projects):

- **User config:** `~/.config/Qoder/SharedClientCache/mcp.json`
- **Extension config:** `~/.config/Qoder/SharedClientCache/extension/local/mcp.json`

```json
{
  "leantime": {
    "type": "sse",
    "url": "https://mcp.project.cocofriday.com/mcp"
  }
}
```

No API key, token, or credentials needed on the client side. Authentication is handled internally by the MCP server.

---

## What is Leantime?

[Leantime](https://leantime.io/) is an open-source project management system used at **Nexatech** (the user's workplace). This MCP connection allows Qoder to:

- View and manage projects, milestones, and tasks
- Create and update tickets
- Track time and progress
- Query project status
- Sync work updates between Solo Empire and Nexatech's Leantime instance

---

## Health Check

```bash
curl https://mcp.project.cocofriday.com/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "leantime-mcp-server",
  "leantime_url": "http://leantime:8080",
  "connected": true
}
```

---

## Security Notes

- **No client-side auth**: Anyone with the URL can use all 17 tools
- **API key is server-internal**: The Leantime API key is configured on the MCP server itself, not exposed to clients
- **Future hardening**: If access restriction is needed, add API key checks at the nginx proxy level or in server middleware

---

## Available Tools (17)

The server exposes tools for full Leantime project management. Use Qoder's MCP tool discovery to list all available tools once connected.

---

## Related Files

| File | Purpose |
|------|---------|
| `~/.config/Qoder/SharedClientCache/mcp.json` | User-level MCP server config (global) |
| `mcp/MCP-REFERENCE.md` | Full MCP server inventory |
| `mcp/MCP-CONFIGURATION-FIXED.md` | General MCP setup guide |
