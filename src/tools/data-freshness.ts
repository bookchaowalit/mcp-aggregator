import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerDataFreshnessTools({
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
        "check_data_freshness",
        "Check freshness of dashboard files and data directories — detect stale or missing data",
        {
            threshold_hours: z.number().optional().describe("Override default thresholds (hours)"),
        },
        async ({ threshold_hours }) => {
            const args: string[] = [];
            if (threshold_hours) args.push("--threshold", String(threshold_hours));
            const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "data_freshness.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

}
