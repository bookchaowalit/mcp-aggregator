import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerAnalyticsTools({
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
        "revenue_analytics",
        "Run revenue analytics — trends, by-source breakdown, growth rates, forecasting",
        {
            source_type: z.string().optional().describe("Filter by source type"),
            forecast: z.boolean().optional().describe("Include forecast"),
        },
        async ({ source_type, forecast }) => {
            const args: string[] = [];
            if (source_type) args.push("--source", source_type);
            if (forecast) args.push("--forecast");
            const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "revenue_analytics.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "habit_analytics",
        "Run habit analytics — streak data, completion rates, patterns",
        {
            habit_id: z.number().optional().describe("Filter by habit ID"),
        },
        async ({ habit_id }) => {
            const args: string[] = [];
            if (habit_id) args.push("--habit-id", String(habit_id));
            const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "habit_analytics.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "goal_velocity",
        "Run goal velocity analysis — progress rate, ETA, at-risk goals",
        {},
        async () => {
            const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "goal_velocity.py"));
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

}
