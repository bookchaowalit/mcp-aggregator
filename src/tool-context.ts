import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { execFile } from "child_process";

export type ToolContext = {
    server: McpServer;
    runPyScript: (scriptPath: string, args?: string[]) => Promise<any>;
    repoRoot: string;
    scriptsDir: string;
    python: string;
    moduleDir: string;
    execFile: typeof execFile;
    fs: typeof import("fs");
};
