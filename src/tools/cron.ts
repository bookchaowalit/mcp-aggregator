import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerCronTools({
    server,
    runPyScript,
    scriptsDir: SCRIPTS_DIR,
}: ToolContext): void {

    server.tool(
        "system_health",
        "Get overall system health — combines system status, cron health, data freshness, and alerts",
        {},
        async () => {
            const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "system_health.py"));
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

}
