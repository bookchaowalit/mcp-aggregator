# mcp-aggregator

Local MCP server for Solo Empire (`bookchaowalit/mcp-aggregator`), split from the
`solo-empire` hub (`infra/mcp-server/`, history kept via `git subtree split`)
together with the MCP docs (`docs/`, from the hub's `mcp/`).

## Run

```bash
npm ci
npx tsx src/index.ts      # stdio MCP server
```

Wire it from a harness with `npx tsx <this checkout>/src/index.ts` (the
`solo-empire` registry repo's `.mcp.json` does this).

## Checks

```bash
task check
# or: npx tsc --noEmit && npx tsx --test tests/*.test.ts
```

Run tests with `EMPIRE_CLIENT_CONFIG=/nonexistent` so nothing reaches production APIs.
Tests that need the `ops-toolkit` owner CLI skip clearly when it is absent.

## Sibling repositories (no hub dependency)

| Need | Env var | Default |
|---|---|---|
| Python scripts the tools shell out to (`utils/*.py`, `cli/*.py`, `workflows/*.py`) | `SOLO_OPS_ROOT` or `SOLO_OPS_SCRIPTS_DIR` | `../ops-toolkit`, scripts in `infra/scripts` |
| Brave bookmark workflow | `SOLO_DATA_LAKE_ROOT` | `../data-lake` |
| API endpoints/tokens | `EMPIRE_*_API`, `EMPIRE_AUTOMATION_TOKEN_*`, `EMPIRE_CLIENT_CONFIG` | see `docs/MCP-REFERENCE.md` |

A tool whose script is missing fails with a clear message instead of guessing a path.
