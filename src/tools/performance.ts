import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { compareValues, openTaskStore } from "../task-store.js";

export function registerPerformanceTools({
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
        "db_stats",
        "Show comprehensive database statistics — size, tables, indexes, task distribution",
        {},
        async () => {
            const db = await getDb();
            const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
            const tableCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as any).c;
            const indexCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").get() as any).c;
            const store = openTaskStore(db, "dashboard-api", { channel: "mcp" });
            const taskCount = (await store.stats(null, { include_archived: true })).total;
            const byStatus = (await store.stats("status", { include_archived: true })).groups
                .map((group) => ({ status: group.key, count: group.count }));
            const byPriority = (await store.stats("priority", { include_archived: true })).groups
                .map((group) => ({ priority: group.key === null ? null : Number(group.key), count: group.count }))
                .sort((a, b) => compareValues(a.priority, b.priority));
            const byProject = (await store.stats("project", { include_archived: true })).groups
                .filter((group) => group.key !== null)
                .map((group) => ({ project: group.key, count: group.count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        db_size_bytes: dbSize.size,
                        db_size_mb: (dbSize.size / 1024 / 1024).toFixed(2),
                        tables: tableCount,
                        indexes: indexCount,
                        total_tasks: taskCount,
                        by_status: byStatus,
                        by_priority: byPriority,
                        top_projects: byProject,
                    }, null, 2),
                }],
            };
        },
    );

    server.tool(
        "take_perf_snapshot",
        "Take a performance snapshot — captures current DB metrics",
        {
            snapshot_type: z.string().optional().default("manual"),
        },
        async ({ snapshot_type }) => {
            const db = await getDb();
            const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
            const taskCount = (await openTaskStore(db, "dashboard-api", { channel: "mcp" }).stats(null, { include_archived: true })).total;
            const tableCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as any).c;
            const indexCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").get() as any).c;
            const metrics = JSON.stringify({ db_size: dbSize.size, tasks: taskCount, tables: tableCount, indexes: indexCount });
            db.prepare("INSERT INTO performance_snapshots (snapshot_type, metrics_json) VALUES (?, ?)").run(snapshot_type || "manual", metrics);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, snapshot_type, metrics: JSON.parse(metrics) }) }] };
        },
    );

    server.tool(
        "run_integrity_check",
        "Run database integrity check (PRAGMA integrity_check + foreign_key_check)",
        {},
        async () => {
            const db = await getDb();
            const integrity = db.prepare("PRAGMA integrity_check").get() as any;
            const fkIssues = db.prepare("PRAGMA foreign_key_check").all();
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        integrity: integrity.integrity_check,
                        fk_issues_count: fkIssues.length,
                        fk_issues: fkIssues.length > 0 ? fkIssues.slice(0, 10) : [],
                    }, null, 2),
                }],
            };
        },
    );

    server.tool(
        "vacuum_db",
        "Compact the database file (VACUUM) and report size savings",
        {},
        async () => {
            const db = await getDb();
            const before = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
            db.exec("VACUUM");
            const after = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
            const saved = before.size - after.size;
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        before_bytes: before.size,
                        after_bytes: after.size,
                        saved_bytes: saved,
                        saved_kb: (saved / 1024).toFixed(1),
                    }),
                }],
            };
        },
    );

    server.tool(
        "list_cache",
        "List cached entries",
        {
            include_expired: z.boolean().optional(),
        },
        async ({ include_expired }) => {
            const db = await getDb();
            const sql = include_expired
                ? "SELECT * FROM cache_entries ORDER BY created_at DESC"
                : "SELECT * FROM cache_entries WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC";
            const entries = db.prepare(sql).all();
            return { content: [{ type: "text", text: JSON.stringify({ cache_entries: entries, count: entries.length }, null, 2) }] };
        },
    );

    server.tool(
        "optimize_indexes",
        "Create composite indexes and run ANALYZE for query optimization",
        {},
        async () => {
            const db = await getDb();
            const created: string[] = [];
            const compositeIndexes = [
                "CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority)",
                "CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project, status)",
                "CREATE INDEX IF NOT EXISTS idx_tasks_due_priority ON tasks(due_date, priority)",
            ];
            for (const idx of compositeIndexes) {
                db.exec(idx);
                const name = idx.match(/idx_\w+/)?.[0] || "unknown";
                created.push(name);
            }
            db.exec("ANALYZE");
            return { content: [{ type: "text", text: JSON.stringify({ success: true, indexes_created: created, analyze: true }) }] };
        },
    );

    server.tool(
        "list_query_stats",
        "View query performance statistics",
        {
            limit: z.number().optional().default(20),
            query_name: z.string().optional(),
        },
        async ({ limit, query_name }) => {
            const db = await getDb();
            const sql = query_name
                ? "SELECT query_name, COUNT(*) as calls, AVG(execution_time_ms) as avg_ms, MAX(execution_time_ms) as max_ms, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as errors FROM query_stats WHERE query_name = ? GROUP BY query_name"
                : "SELECT query_name, COUNT(*) as calls, AVG(execution_time_ms) as avg_ms, MAX(execution_time_ms) as max_ms, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as errors FROM query_stats GROUP BY query_name ORDER BY calls DESC LIMIT ?";
            const rows = query_name
                ? db.prepare(sql).all(query_name)
                : db.prepare(sql).all(limit);
            return { content: [{ type: "text", text: JSON.stringify({ stats: rows }, null, 2) }] };
        },
    );

}
