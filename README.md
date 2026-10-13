# mcp-aggregator

Local MCP server for Solo Empire (`bookchaowalit/platform-mcp-aggregator`), split from the
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
| Python scripts the tools shell out to (`utils/*.py`, `cli/*.py`, `workflows/*.py`) | `SOLO_OPS_ROOT` or `SOLO_OPS_SCRIPTS_DIR` | `../platform-ops-cli`, scripts in `infra/scripts` |
| Brave bookmark workflow | `SOLO_DATA_LAKE_ROOT` | `../data-lake-pipelines` |
| Delivery workflow, roles, refinement and central templates | `SOLO_ARCHITECTURE_ROOT` | `../architecture-docs` |
| API endpoints/tokens | `EMPIRE_*_API`, `EMPIRE_AUTOMATION_TOKEN_*`, `EMPIRE_CLIENT_CONFIG` | see `docs/MCP-REFERENCE.md` |

A tool whose script is missing fails with a clear message instead of guessing a path.

## Delivery context

`get_delivery_context` อ่านนิยาม workflow, role, เอกสาร, refinement และแม่แบบกลาง
ผ่าน exporter ที่กำหนดไว้ใน `architecture-docs/scripts/delivery_context.py` เท่านั้น
รองรับ `view`: `overview`, `role`, `workflow`, `documents`, `refinement`, `artifact`.
ตัวอย่าง arguments: `{"view":"refinement","role":"business-analyst","step":"BA03"}`.
`role` view ต้องระบุ role; `artifact` view ใช้ `artifact_id` จากผลอ่านก่อนหน้า
และแบ่งหน้าได้ด้วย `offset`/`limit` (เริ่ม 0/8000, สูงสุด 16000 ตัวอักษรต่อหน้า).

ผลใช้ contract `solo-empire.delivery-context.v1` พร้อมเวอร์ชันและ SHA256 ของแหล่งข้อมูล
adapter ตรวจข้อมูลกับไฟล์ก่อนส่งกลับ และคืน error code เมื่อ exporter ขาดหาย
ข้อมูลผิดรูปแบบ หมดเวลา หรือหลักฐานแหล่งข้อมูลเปลี่ยน ไม่คืน raw output หรือ paths
จาก error. ผู้เรียกกำหนด root, path, command หรือ environment ไม่ได้.

ความพร้อมนี้หมายถึง **อ่านนิยามเอกสารได้**; `runtime_integrated` ยังคง `false`
และ `content_truth`, `live_readiness`, `business_acceptance`, `release_authorization`
เป็น `not_verified`. ไม่มีการสร้างงาน อนุมัติ ส่งเอกสารลูกค้า หรือเรียก production API.

MCP นี้ใช้ local stdio. หลังอัปเดต checkout ต้องเริ่ม process ใหม่/เชื่อม session ใหม่
แล้วตรวจ `tools/list` ว่ามี `get_delivery_context`; session เดิมไม่รับ tool เพิ่มโดยอัตโนมัติ.
ยังไม่มี target สำหรับ hosted deployment ที่ระบุไว้ใน repository นี้.
