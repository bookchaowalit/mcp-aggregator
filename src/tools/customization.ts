import type { ToolContext } from "../tool-context.js";
import { legacyTaskTypeRow, openTaskStore } from "../task-store.js";

export function registerCustomizationTools({ server }: Pick<ToolContext, "server">): void {

    server.tool(
        "list_task_types",
        "List custom task types/workflows",
        {},
        async () => {
            const types = (await openTaskStore("dashboard-api", { channel: "mcp" }).taskTypes()).map(legacyTaskTypeRow);
            return { content: [{ type: "text", text: JSON.stringify({ task_types: types }, null, 2) }] };
        },
    );

}
