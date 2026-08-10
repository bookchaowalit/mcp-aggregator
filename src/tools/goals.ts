import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerGoalsTools({
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
        "get_goals",
        "Get goals with tasks",
        {
            type: z.string().optional(),
            status: z.string().optional(),
            category: z.string().optional(),
        },
        async (params) => {
            const db = await getDb();
            let query = "SELECT * FROM goals WHERE 1=1";
            const args: any[] = [];
            if (params.type) {
                query += " AND type = ?";
                args.push(params.type);
            }
            if (params.status) {
                query += " AND status = ?";
                args.push(params.status);
            }
            if (params.category) {
                query += " AND category = ?";
                args.push(params.category);
            }
            query += " ORDER BY priority ASC, due_date ASC";
            const goals = db.prepare(query).all(...args) as any[];
            const goalsWithTasks = goals.map((g) => ({
                ...g,
                tasks: db
                    .prepare(
                        "SELECT * FROM goal_tasks WHERE goal_id = ? ORDER BY sort_order",
                    )
                    .all(g.id),
            }));
            return {
                content: [
                    { type: "text", text: JSON.stringify(goalsWithTasks, null, 2) },
                ],
            };
        },
    );

    server.tool(
        "add_goal",
        "Add a new goal",
        {
            title: z.string(),
            description: z.string().optional(),
            type: z.string(),
            category: z.string(),
            priority: z.number().optional(),
            start_date: z.string().optional(),
            due_date: z.string().optional(),
        },
        async (params) => {
            const db = await getDb();
            const result = db
                .prepare(
                    "INSERT INTO goals (title, description, type, category, priority, start_date, due_date, status, progress_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .run(
                    params.title,
                    params.description || null,
                    params.type,
                    params.category,
                    params.priority || 3,
                    params.start_date || null,
                    params.due_date || null,
                    "planning",
                    0,
                );
            const goal = db
                .prepare("SELECT * FROM goals WHERE id = ?")
                .get(result.lastInsertRowid);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ success: true, goal }, null, 2),
                    },
                ],
            };
        },
    );

    server.tool(
        "update_goal",
        "Update a goal",
        {
            id: z.number(),
            title: z.string().optional(),
            description: z.string().optional(),
            status: z.string().optional(),
            progress_percent: z.number().min(0).max(100).optional(),
            priority: z.number().optional(),
        },
        async ({ id, ...params }) => {
            const db = await getDb();
            const sets: string[] = [];
            const vals: any[] = [];
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined) {
                    sets.push(`${k} = ?`);
                    vals.push(v);
                }
            }
            if (params.status === "completed")
                sets.push("completed_at = CURRENT_TIMESTAMP");
            if (sets.length > 0) {
                sets.push("updated_at = CURRENT_TIMESTAMP");
                vals.push(id);
                db.prepare(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`).run(
                    ...vals,
                );
            }
            const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ success: true, goal }, null, 2),
                    },
                ],
            };
        },
    );

}
