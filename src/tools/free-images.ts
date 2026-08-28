import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

const SCRIPT = "utils/free_image_assets.py";

export function registerFreeImageTools({
    server,
    runPyScript,
    repoRoot: REPO_ROOT,
    scriptsDir: SCRIPTS_DIR,
    python: PYTHON,
    execFile,
}: ToolContext): void {
    server.tool(
        "list_free_images",
        "List locally catalogued free-stock images downloaded via official APIs. Does not scrape HTML.",
        {
            limit: z.number().int().min(1).max(200).optional().describe("Max catalog rows"),
        },
        async ({ limit }) => {
            const args = ["--list"];
            if (limit) args.push("--limit", String(limit));
            const result = await runPyScript(resolve(SCRIPTS_DIR, SCRIPT), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "fetch_free_images",
        "Search official free-image APIs (Openverse by default; Pexels/Unsplash if keys exist). Set apply=true to download into media/references/free-stock/ with license sidecars. Never scrapes HTML.",
        {
            query: z.string().optional().describe("Search query, e.g. japanese temple"),
            pack: z.enum(["editor", "drink", "etsy"]).optional().describe("Curated query set for editor/art work"),
            provider: z.enum(["openverse", "pexels", "unsplash", "auto"]).optional(),
            limit: z.number().int().min(1).max(20).optional(),
            apply: z.boolean().optional().describe("If true, download files. Default is search-only."),
        },
        async ({ query, pack, provider, limit, apply }) => {
            if (!query && !pack) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({ error: "query_or_pack_required" }),
                    }],
                };
            }
            const args: string[] = [];
            if (query) args.push(query);
            if (pack) args.push("--pack", pack);
            if (provider) args.push("--provider", provider);
            if (limit) args.push("--limit", String(limit));
            if (apply) args.push("--apply");
            args.push("--json");
            const script = resolve(SCRIPTS_DIR, SCRIPT);
            const result = await new Promise<unknown>((fulfill, reject) => {
                execFile(
                    PYTHON,
                    [script, ...args],
                    {
                        cwd: REPO_ROOT,
                        timeout: apply ? 180_000 : 45_000,
                        maxBuffer: 2 * 1024 * 1024,
                    },
                    (err: Error | null, stdout: string, stderr: string) => {
                        if (err) {
                            reject(new Error((stderr || err.message).slice(0, 500)));
                            return;
                        }
                        try {
                            fulfill(JSON.parse(stdout));
                        } catch {
                            fulfill({ raw: stdout.slice(0, 4000) });
                        }
                    },
                );
            });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );
}
