import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

const SCRIPT = "cli/seo-cli.py";

export function registerSeoReportTools({
    server,
    runPyScript,
    scriptsDir: SCRIPTS_DIR,
}: ToolContext): void {
    server.tool(
        "seo_report_status",
        "Show existing Pixiu Watch SEO monthly packs. Does not crawl, send, or invent GA4 numbers.",
        {
            client: z.string().optional().describe("SEO client slug. Default pixiu-watch"),
        },
        async ({ client }) => {
            const args = ["status"];
            if (client) args.push("--client", client);
            const result = await runPyScript(resolve(SCRIPTS_DIR, SCRIPT), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "seo_monthly_report",
        "Build a client SEO monthly pack from a local Search Console zip and optional Ahrefs/GA4 files, or the july-2026 fixture. Dry-run unless apply=true. Never crawls the live site or sends the report.",
        {
            client: z.string().optional(),
            month: z.string().optional().describe("YYYY-MM"),
            gsc: z.string().optional().describe("Path to Search Console Performance zip"),
            ahrefs: z.string().optional().describe("Path to Ahrefs Site Audit JSON or CSV"),
            ga4: z.string().optional().describe("Path to GA4 JSON. Omit when unavailable."),
            fixture: z.enum(["july-2026"]).optional(),
            source: z.enum(["files", "gmail"]).optional().describe("gmail pulls Search Console/Ahrefs notices. Default files."),
            apply: z.boolean().optional().describe("Write pack.json, markdown, and HTML. Default false."),
        },
        async ({ client, month, gsc, ahrefs, ga4, fixture, source, apply }) => {
            const args = source === "gmail" ? ["fetch"] : ["report"];
            if (client) args.push("--client", client);
            if (month) args.push("--month", month);
            if (gsc) args.push("--gsc", gsc);
            if (ahrefs) args.push("--ahrefs", ahrefs);
            if (ga4) args.push("--ga4", ga4);
            if (fixture) args.push("--fixture", fixture);
            if (source && source !== "gmail") args.push("--source", source);
            if (apply) args.push("--apply");
            const result = await runPyScript(resolve(SCRIPTS_DIR, SCRIPT), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );
}
