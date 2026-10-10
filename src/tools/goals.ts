import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { openCellStore } from "../cell-store.js";
import { sortRows } from "../portfolio-reads.js";

const goalsCell = () => openCellStore("goals", "legacy-mcp", { channel: "mcp" });

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
            const cell = goalsCell();
            const filters: Record<string, string> = {};
            if (params.type) filters.type = params.type;
            if (params.status) filters.status = params.status;
            if (params.category) filters.category = params.category;
            const goals = sortRows(await cell.list("goals", filters), ["priority"], ["due_date"]);
            const goalTasks = sortRows(await cell.list("goal-tasks"), ["sort_order"]);
            const goalsWithTasks = goals.map((g) => ({
                ...g,
                tasks: goalTasks.filter((t) => t.goal_id === g.id),
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
            const goal = await goalsCell().create("goals", {
                title: params.title,
                description: params.description || null,
                type: params.type,
                category: params.category,
                priority: params.priority || 3,
                start_date: params.start_date || null,
                due_date: params.due_date || null,
                status: "planning",
                progress_percent: 0,
            });
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
            const cell = goalsCell();
            const fields: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined) fields[k] = v;
            }
            if (params.status === "completed") fields.completed_at = new Date().toISOString();
            const goal = Object.keys(fields).length > 0
                ? await cell.update("goals", id, fields)
                : await cell.get("goals", id);
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
