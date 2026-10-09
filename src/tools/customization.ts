import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { compareValues, legacyTaskRow, legacyTaskTypeRow, openTaskStore, sqlLike } from "../task-store.js";

export function registerCustomizationTools({
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
        "list_custom_fields",
        "List custom field definitions for tasks",
        {},
        async () => {
            const db = await getDb();
            const fields = db.prepare("SELECT * FROM custom_fields ORDER BY sort_order, name").all();
            return { content: [{ type: "text", text: JSON.stringify({ custom_fields: fields }, null, 2) }] };
        },
    );

    server.tool(
        "list_preferences",
        "List user preferences/settings",
        {},
        async () => {
            const db = await getDb();
            const prefs = db.prepare("SELECT * FROM user_preferences ORDER BY pref_key").all();
            return { content: [{ type: "text", text: JSON.stringify({ preferences: prefs }, null, 2) }] };
        },
    );

    server.tool(
        "update_preference",
        "Update a user preference value",
        {
            pref_key: z.string(),
            pref_value: z.string(),
        },
        async ({ pref_key, pref_value }) => {
            const db = await getDb();
            const result = db.prepare(
                "UPDATE user_preferences SET pref_value = ?, updated_at = datetime('now') WHERE pref_key = ?"
            ).run(pref_value, pref_key);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, updated: result.changes > 0, pref_key, pref_value }) }] };
        },
    );

    server.tool(
        "list_task_types",
        "List custom task types/workflows",
        {},
        async () => {
            const db = await getDb();
            const types = (await openTaskStore(db, "dashboard-api", { channel: "mcp" }).taskTypes()).map(legacyTaskTypeRow);
            return { content: [{ type: "text", text: JSON.stringify({ task_types: types }, null, 2) }] };
        },
    );

    server.tool(
        "list_custom_views",
        "List saved custom views/filters",
        {},
        async () => {
            const db = await getDb();
            const views = db.prepare(
                "SELECT cv.*, c.name as owner_name FROM custom_views cv LEFT JOIN collaborators c ON cv.owner_id = c.id ORDER BY cv.name"
            ).all();
            return { content: [{ type: "text", text: JSON.stringify({ custom_views: views }, null, 2) }] };
        },
    );

    server.tool(
        "run_custom_view",
        "Execute a saved custom view and return matching tasks",
        {
            view_id: z.number(),
        },
        async ({ view_id }) => {
            const db = await getDb();
            const view = db.prepare("SELECT * FROM custom_views WHERE id = ?").get(view_id) as any;
            if (!view) return { content: [{ type: "text", text: JSON.stringify({ error: "View not found" }) }] };

            let filter = view.filter_criteria ? JSON.parse(view.filter_criteria) : {};
            const store = openTaskStore(db, "dashboard-api", { channel: "mcp" });
            let tasks = (await store.list(filter.project ? { project: filter.project } : {})).map(legacyTaskRow);

            if (filter.status) {
                const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                tasks = tasks.filter((task) => statuses.includes(task.status));
            }
            if (filter.priority) {
                const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
                tasks = tasks.filter((task) => priorities.includes(task.priority));
            }
            if (filter.tags) {
                const tags = Array.isArray(filter.tags) ? filter.tags : [filter.tags];
                tasks = tasks.filter((task) => tags.every((t: string) => sqlLike(task.tags, `%${t}%`)));
            }

            // Sort
            let sort = view.sort_criteria ? JSON.parse(view.sort_criteria) : null;
            const keys: Array<[string, number]> = [["priority", 1], ["due_date", 1]];
            if (sort && sort.field) {
                const direction = String(sort.direction || "ASC").toUpperCase();
                if (direction !== "ASC" && direction !== "DESC") throw new Error(`invalid sort direction: ${sort.direction}`);
                if (tasks.length && !(sort.field in tasks[0])) throw new Error(`invalid sort field: ${sort.field}`);
                keys.splice(0, keys.length, [sort.field, direction === "DESC" ? -1 : 1]);
            }
            tasks.sort((a, b) => {
                for (const [field, sign] of keys) {
                    const order = compareValues(a[field], b[field]) * sign;
                    if (order) return order;
                }
                return a.id - b.id;
            });
            return { content: [{ type: "text", text: JSON.stringify({ view: view.name, task_count: tasks.length, tasks }, null, 2) }] };
        },
    );

}
