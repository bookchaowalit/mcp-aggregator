import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerTasksTools({
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
        "list_tasks",
        "List all tasks from the local task management system. Supports filtering by status, project, and priority.",
        {
            status: z.enum(["todo", "in_progress", "done", "blocked", "cancelled"]).optional(),
            project: z.string().optional(),
            priority: z.number().min(1).max(5).optional(),
            limit: z.number().min(1).max(100).default(50),
        },
        async (params) => {
            const db = await getDb();
            let sql = "SELECT * FROM tasks WHERE 1=1";
            const values: any[] = [];

            if (params.status) { sql += " AND status = ?"; values.push(params.status); }
            if (params.project) { sql += " AND project = ?"; values.push(params.project); }
            if (params.priority) { sql += " AND priority = ?"; values.push(params.priority); }
            sql += " ORDER BY priority ASC, created_at DESC LIMIT ?";
            values.push(params.limit);

            const tasks = db.prepare(sql).all(...values);
            return {
                content: [{ type: "text", text: JSON.stringify({ total: tasks.length, tasks }, null, 2) }],
            };
        },
    );

    server.tool(
        "create_task",
        "Create a new local task. Employer work is managed in nexatech-empire and is not synced here.",
        {
            title: z.string().describe("Task title"),
            description: z.string().optional().describe("Task description"),
            status: z.enum(["todo", "in_progress", "done", "blocked"]).default("todo"),
            priority: z.number().min(1).max(5).default(3).describe("1=highest, 5=lowest"),
            project: z.string().optional(),
            category: z.string().optional().describe("income, ops, learning, health, creative, admin"),
            due_date: z.string().optional().describe("Due date YYYY-MM-DD"),
            tags: z.string().optional().describe("Comma-separated tags"),
        },
        async (params) => {
            const db = await getDb();
            const tagsJson = params.tags ? JSON.stringify(params.tags.split(",").map(t => t.trim())) : null;
            const result = db.prepare(`
                INSERT INTO tasks (title, description, status, priority, project, category, due_date, tags, sync_status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', datetime('now'), datetime('now'))
            `).run(
                params.title, params.description || null, params.status, params.priority,
                params.project || null, params.category || null, params.due_date || null, tagsJson
            );
            const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.lastInsertRowid);
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, task, message: "Task created locally. Personal sources can be synced separately." }, null, 2) }],
            };
        },
    );

    server.tool(
        "update_task",
        "Update an existing local task. Employer work is managed in nexatech-empire.",
        {
            id: z.number().describe("Task ID"),
            title: z.string().optional(),
            description: z.string().optional(),
            status: z.enum(["todo", "in_progress", "done", "blocked", "cancelled"]).optional(),
            priority: z.number().min(1).max(5).optional(),
            project: z.string().optional(),
            due_date: z.string().optional(),
        },
        async (params) => {
            const db = await getDb();
            const { id, ...fields } = params;
            const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
            if (!existing) {
                return { content: [{ type: "text", text: JSON.stringify({ error: `Task ${id} not found` }) }] };
            }

            const updates: string[] = [];
            const values: any[] = [];
            for (const [key, val] of Object.entries(fields)) {
                if (val !== undefined) {
                    updates.push(`${key} = ?`);
                    values.push(val);
                }
            }
            if (updates.length === 0) {
                return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
            }

            // Mark as dirty so sync pushes to external
            const newStatus = params.status || existing.status;
            const completedAt = newStatus === "done" && existing.status !== "done" ? "datetime('now')" : null;

            if (completedAt) {
                updates.push("completed_at = datetime('now')");
            }
            updates.push("sync_status = 'dirty'");
            updates.push("updated_at = datetime('now')");

            db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...values, id);
            const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, task: updated, message: "Task updated. Run sync to push changes." }, null, 2) }],
            };
        },
    );

    server.tool(
        "complete_task",
        "Mark a local task as done.",
        { id: z.number().describe("Task ID") },
        async (params) => {
            const db = await getDb();
            const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.id) as any;
            if (!existing) {
                return { content: [{ type: "text", text: JSON.stringify({ error: `Task ${params.id} not found` }) }] };
            }
            db.prepare(`
                UPDATE tasks SET status = 'done', completed_at = datetime('now'),
                  sync_status = 'dirty', updated_at = datetime('now')
                WHERE id = ?
            `).run(params.id);
            const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.id);
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, task: updated }, null, 2) }],
            };
        },
    );

    server.tool(
        "delete_task",
        "Delete a local task. External employer records are managed outside Solo Empire.",
        { id: z.number().describe("Task ID") },
        async (params) => {
            const db = await getDb();
            const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.id) as any;
            if (!task) {
                return { content: [{ type: "text", text: JSON.stringify({ error: `Task ${params.id} not found` }) }] };
            }
            db.prepare("DELETE FROM tasks WHERE id = ?").run(params.id);
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, deleted: task.title, warning: task.external_id ? "External record is managed outside Solo Empire" : undefined }, null, 2) }],
            };
        },
    );

    server.tool(
        "task_sync_status",
        "Show task sync status — personal sources (Todoist/Jira/Notion), sync state, and project. Employer work is external.",
        {},
        async () => {
            const db = await getDb();
            const total = db.prepare("SELECT COUNT(*) as c FROM tasks").get() as any;
            const byStatus = db.prepare("SELECT status, COUNT(*) as c FROM tasks GROUP BY status").all();
            const bySync = db.prepare("SELECT sync_status, COUNT(*) as c FROM tasks GROUP BY sync_status").all();
            const byProject = db.prepare("SELECT project, COUNT(*) as c FROM tasks WHERE project IS NOT NULL GROUP BY project ORDER BY c DESC").all();
            const bySource = db.prepare("SELECT external_source, COUNT(*) as c FROM tasks WHERE external_source IS NOT NULL GROUP BY external_source").all();
            const workCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE external_source = 'leantime'").get() as any).c;
            const personalCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE external_source IS NULL OR external_source != 'leantime'").get() as any).c;
            const dirty = db.prepare("SELECT id, title, sync_status, external_source FROM tasks WHERE sync_status IN ('dirty', 'conflict') ORDER BY priority").all();
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        total: total.c,
                        work_nexatech: workCount,
                        personal: personalCount,
                        by_status: byStatus,
                        by_sync: bySync,
                        by_project: byProject,
                        by_source: bySource,
                        needs_sync: dirty,
                    }, null, 2),
                }],
            };
        },
    );

}
