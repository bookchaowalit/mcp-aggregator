import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

/**
 * AI-facing boundary for Brave bookmark knowledge intake.
 *
 * This tool only manages private proposals. It never writes the live Brave
 * profile directly; the approved proposals are applied by the scheduled
 * maintenance job when Brave is closed.
 */
export function registerBrowserBookmarkTools({
    server,
    runPyScript,
    scriptsDir: SCRIPTS_DIR,
}: ToolContext): void {
    server.tool(
        "manage_brave_bookmark_proposals",
        "Create, list, approve, or reject Brave bookmark proposals. Use propose when the user explicitly asks to save a useful website/webapp or selects a discovered knowledge resource. The scheduled cron job syncs and applies approved proposals when Brave is closed; this tool never writes the live Brave profile directly.",
        {
            action: z.enum(["propose", "list", "approve", "reject"]).describe("Proposal operation"),
            url: z.string().optional().describe("Absolute http(s) URL; required for propose"),
            title: z.string().optional().describe("Human-readable bookmark title; required for propose"),
            folder: z.string().optional().describe("Approved folder/subfolder path, e.g. '04 - Learning/Courses & Documentation'"),
            profile: z.string().optional().default("Default").describe("Brave profile name"),
            source_kind: z.enum(["ai_discovery", "manual", "technology_watch", "learning"]).optional().default("ai_discovery"),
            source_ref: z.string().optional().describe("Short non-sensitive source reference, such as a conversation or task ID"),
            reason: z.string().optional().describe("Short non-sensitive reason for saving the bookmark"),
            proposal_id: z.string().optional().describe("Proposal ID; required for approve or reject"),
        },
        async (params) => {
            const script = resolve(SCRIPTS_DIR, "sync", "brave_bookmark_workflow.py");
            const args: string[] = [];

            const append = (flag: string, value: string | undefined) => {
                if (value !== undefined && value.trim() !== "") {
                    args.push(flag, value);
                }
            };

            if (params.action === "propose") {
                if (!params.url || !params.title) {
                    throw new Error("url and title are required for a Brave bookmark proposal");
                }
                args.push("propose");
                append("--url", params.url);
                append("--title", params.title);
                append("--profile", params.profile);
                append("--folder", params.folder);
                append("--source-kind", params.source_kind);
                append("--source-ref", params.source_ref);
                append("--reason", params.reason);
            } else if (params.action === "list") {
                args.push("review");
            } else {
                if (!params.proposal_id) {
                    throw new Error("proposal_id is required for approve or reject");
                }
                args.push("review", params.action === "approve" ? "--approve" : "--reject", params.proposal_id);
            }

            const result = await runPyScript(script, args);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                }],
            };
        },
    );
}
