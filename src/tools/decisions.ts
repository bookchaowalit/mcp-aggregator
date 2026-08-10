import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerDecisionsTools({
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

    async function mutateDecisionTool(
        action: "approve" | "reject" | "defer" | "complete",
        decision_id: number,
        confirm: boolean,
        actor?: string,
        reason?: string,
        outcome?: string,
    ): Promise<{ content: Array<{ type: "text"; text: string }> }> {
        if (!confirm) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: "Explicit confirm=true is required; no decision state was changed.",
                    }),
                }],
            };
        }
        const args = [action, String(decision_id), "--confirm"];
        if (actor) args.push("--actor", actor);
        if (reason) args.push("--reason", reason);
        if (outcome) args.push("--outcome", outcome);
        const result = await runPyScript(resolve(SCRIPTS_DIR, "cli", "decision-cli.py"), args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }


    server.tool(
        "list_decisions",
        "List cross-domain decision proposals. Private and sensitive text is redacted unless explicitly requested.",
        {
            status: z.string().optional(),
            approval_status: z.string().optional(),
            privacy_class: z.string().optional(),
            include_private: z.boolean().optional().default(false),
            limit: z.number().int().min(1).max(100).optional().default(50),
        },
        async ({ status, approval_status, privacy_class, include_private, limit }) => {
            const args = ["list", "--limit", String(limit)];
            if (status) args.push("--status", status);
            if (approval_status) args.push("--approval-status", approval_status);
            if (privacy_class) args.push("--privacy-class", privacy_class);
            if (include_private) args.push("--include-private");
            const result = await runPyScript(resolve(SCRIPTS_DIR, "cli", "decision-cli.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "get_decision",
        "Get one decision record. Private and sensitive text is redacted unless explicitly requested.",
        {
            decision_id: z.number().int().positive(),
            include_private: z.boolean().optional().default(false),
        },
        async ({ decision_id, include_private }) => {
            const args = ["show", String(decision_id)];
            if (include_private) args.push("--include-private");
            const result = await runPyScript(resolve(SCRIPTS_DIR, "cli", "decision-cli.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "list_decision_events",
        "View the append-only lifecycle audit events for one decision.",
        {
            decision_id: z.number().int().positive(),
            include_private: z.boolean().optional().default(false),
        },
        async ({ decision_id, include_private }) => {
            const args = ["events", String(decision_id)];
            if (include_private) args.push("--include-private");
            const result = await runPyScript(resolve(SCRIPTS_DIR, "cli", "decision-cli.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "approve_decision",
        "Record human approval for a proposed decision. This queues the declared action but never executes it.",
        {
            decision_id: z.number().int().positive(),
            confirm: z.boolean().describe("Must be true to record approval"),
            actor: z.string().max(120).optional(),
            reason: z.string().max(500).optional(),
        },
        async ({ decision_id, confirm, actor, reason }) => mutateDecisionTool("approve", decision_id, confirm, actor, reason),
    );

    server.tool(
        "reject_decision",
        "Reject a proposed decision and block its declared action. No external action is executed.",
        {
            decision_id: z.number().int().positive(),
            confirm: z.boolean().describe("Must be true to record rejection"),
            actor: z.string().max(120).optional(),
            reason: z.string().max(500).optional(),
        },
        async ({ decision_id, confirm, actor, reason }) => mutateDecisionTool("reject", decision_id, confirm, actor, reason),
    );

    server.tool(
        "defer_decision",
        "Defer a decision and block its declared action until a later review.",
        {
            decision_id: z.number().int().positive(),
            confirm: z.boolean().describe("Must be true to record deferral"),
            actor: z.string().max(120).optional(),
            reason: z.string().max(500).optional(),
        },
        async ({ decision_id, confirm, actor, reason }) => mutateDecisionTool("defer", decision_id, confirm, actor, reason),
    );

    server.tool(
        "complete_decision",
        "Record an outcome for a decision after its action was performed externally by an authorized human or workflow. This tool itself performs no side effect.",
        {
            decision_id: z.number().int().positive(),
            confirm: z.boolean().describe("Must be true to record completion"),
            outcome: z.string().min(1).max(500),
            actor: z.string().max(120).optional(),
            reason: z.string().max(500).optional(),
        },
        async ({ decision_id, confirm, outcome, actor, reason }) => mutateDecisionTool("complete", decision_id, confirm, actor, reason, outcome),
    );

    server.tool(
        "list_decision_reviews",
        "List scheduled decision reviews. Private and sensitive review text is redacted unless explicitly requested.",
        {
            status: z.string().optional(),
            include_private: z.boolean().optional().default(false),
            limit: z.number().int().min(1).max(100).optional().default(50),
        },
        async ({ status, include_private, limit }) => {
            const args = ["reviews", "--limit", String(limit)];
            if (status) args.push("--status", status);
            if (include_private) args.push("--include-private");
            const result = await runPyScript(resolve(SCRIPTS_DIR, "cli", "decision-cli.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "sync_decision_reviews",
        "Preview or create local review tasks for decisions due for review. Defaults to preview; confirm=true is required to write local task records.",
        {
            as_of: z.string().optional().describe("Review date YYYY-MM-DD; defaults to today"),
            confirm: z.boolean().optional().default(false).describe("Must be true to create local review tasks"),
        },
        async ({ as_of, confirm }) => {
            const args = [confirm ? "--sync" : "--dry-run"];
            if (as_of) args.push("--as-of", as_of);
            const result = await runPyScript(resolve(SCRIPTS_DIR, "workflows", "decision_review.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "review_decision",
        "Record the outcome of a scheduled decision review and close its local review task. This does not execute the original decision action.",
        {
            review_id: z.number().int().positive(),
            confirm: z.boolean().describe("Must be true to record the review outcome"),
            outcome: z.string().min(1).max(500),
            notes: z.string().max(500).optional(),
            actor: z.string().max(120).optional(),
        },
        async ({ review_id, confirm, outcome, notes, actor }) => {
            if (!confirm) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            error: "Explicit confirm=true is required; no review state was changed.",
                        }),
                    }],
                };
            }
            const args = ["review", String(review_id), "--confirm", "--outcome", outcome];
            if (notes) args.push("--notes", notes);
            if (actor) args.push("--actor", actor);
            const result = await runPyScript(resolve(SCRIPTS_DIR, "cli", "decision-cli.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

}
