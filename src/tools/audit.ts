import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerAuditTools({
    server,
    getDb,
    runPyScript,
    scriptsDir: SCRIPTS_DIR,
    repoRoot: REPO_ROOT,
    python: PYTHON,
    moduleDir: __dirname,
    execFile,
    fs,
}: ToolContext): void {

    server.tool(
        "show_audit_log",
        "View audit log entries — all task/system operations",
        {
            limit: z.number().optional().default(30),
            action: z.string().optional().describe("Filter by action type: create, update, delete, sync, export"),
            target_type: z.string().optional().describe("Filter by target: task, project, collaborator, system"),
        },
        async ({ limit, action, target_type }) => {
            const db = await getDb();
            let sql = "SELECT * FROM audit_log";
            const params: any[] = [];
            const conditions: string[] = [];
            if (action) { conditions.push("action = ?"); params.push(action); }
            if (target_type) { conditions.push("target_type = ?"); params.push(target_type); }
            if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
            sql += " ORDER BY created_at DESC LIMIT ?";
            params.push(limit);
            const rows = db.prepare(sql).all(...params);
            return { content: [{ type: "text", text: JSON.stringify({ audit_log: rows, count: rows.length }, null, 2) }] };
        },
    );

    server.tool(
        "list_backups",
        "List database backup history",
        {
            limit: z.number().optional().default(10),
        },
        async ({ limit }) => {
            const db = await getDb();
            const rows = db.prepare("SELECT * FROM backup_history ORDER BY created_at DESC LIMIT ?").all(limit);
            return { content: [{ type: "text", text: JSON.stringify({ backups: rows }, null, 2) }] };
        },
    );

    server.tool(
        "show_security_events",
        "View security events — failed logins, rate limits, suspicious activity",
        {
            limit: z.number().optional().default(20),
            severity: z.enum(["info", "warning", "critical"]).optional(),
            unresolved_only: z.boolean().optional(),
        },
        async ({ limit, severity, unresolved_only }) => {
            const db = await getDb();
            let sql = "SELECT * FROM security_events";
            const params: any[] = [];
            const conditions: string[] = [];
            if (severity) { conditions.push("severity = ?"); params.push(severity); }
            if (unresolved_only) { conditions.push("resolved = 0"); }
            if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
            sql += " ORDER BY created_at DESC LIMIT ?";
            params.push(limit);
            const rows = db.prepare(sql).all(...params);
            return { content: [{ type: "text", text: JSON.stringify({ events: rows, count: rows.length }, null, 2) }] };
        },
    );

    server.tool(
        "list_permissions",
        "List access permissions for collaborators",
        {
            collaborator_id: z.number().optional(),
        },
        async ({ collaborator_id }) => {
            const db = await getDb();
            const sql = collaborator_id
                ? "SELECT p.*, c.name as collaborator_name FROM access_permissions p LEFT JOIN collaborators c ON p.collaborator_id = c.id WHERE p.collaborator_id = ? AND p.is_active = 1"
                : "SELECT p.*, c.name as collaborator_name FROM access_permissions p LEFT JOIN collaborators c ON p.collaborator_id = c.id WHERE p.is_active = 1 ORDER BY c.name, p.resource_type";
            const rows = collaborator_id
                ? db.prepare(sql).all(collaborator_id)
                : db.prepare(sql).all();
            return { content: [{ type: "text", text: JSON.stringify({ permissions: rows }, null, 2) }] };
        },
    );

}
