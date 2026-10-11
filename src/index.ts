import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root: infra/mcp-server/src (or dist) -> ../../..
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCRIPTS_DIR = resolve(REPO_ROOT, "infra", "scripts");
const PYTHON = process.env.PYTHON || "python3";

/** Helper: run a Python script with --json and return parsed result */
function runPyScript(scriptPath: string, args: string[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
        const fullArgs = [scriptPath, ...args, "--json"];
        execFile(PYTHON, fullArgs, {
            cwd: REPO_ROOT,
            timeout: 30_000,
            maxBuffer: 2 * 1024 * 1024,
        }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr?.slice(0, 500) || err.message));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch {
                resolve({ raw: stdout.slice(0, 4000) });
            }
        });
    });
}

const server = new McpServer({
    name: "solo-empire",
    version: "1.0.0",
});

import type { ToolContext } from "./tool-context.js";
import { registerSkillsTools } from "./tools/skills.js";
import { registerGoalsTools } from "./tools/goals.js";
import { registerRevenueTools } from "./tools/revenue.js";
import { registerDashboardTools } from "./tools/dashboard.js";
import { registerTasksTools } from "./tools/tasks.js";
import { registerDecisionsTools } from "./tools/decisions.js";
import { registerCustomizationTools } from "./tools/customization.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerDataFreshnessTools } from "./tools/data-freshness.js";
import { registerCronTools } from "./tools/cron.js";
import { registerBrowserBookmarkTools } from "./tools/browser-bookmarks.js";
import { registerFreeImageTools } from "./tools/free-images.js";
import { registerSeoReportTools } from "./tools/seo-report.js";

const toolContext: ToolContext = {
    server,
    runPyScript,
    repoRoot: REPO_ROOT,
    scriptsDir: SCRIPTS_DIR,
    python: PYTHON,
    moduleDir: __dirname,
    execFile,
    fs,
};
registerSkillsTools(toolContext);
registerGoalsTools(toolContext);
registerRevenueTools(toolContext);
registerDashboardTools(toolContext);
registerTasksTools(toolContext);
registerDecisionsTools(toolContext);
registerCustomizationTools(toolContext);
registerAnalyticsTools(toolContext);
registerDataFreshnessTools(toolContext);
registerCronTools(toolContext);
registerBrowserBookmarkTools(toolContext);
registerFreeImageTools(toolContext);
registerSeoReportTools(toolContext);

// =====================================================
// START SERVER
// =====================================================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Solo Empire MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
process.on("SIGINT", () => {
    process.exit(0);
});
process.on("SIGTERM", () => {
    process.exit(0);
});
