import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerAiConversationsTools({
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
        "log_ai_conversation",
        "Log an AI conversation/interaction, optionally linked to a project",
        {
            title: z.string().describe("Short title for the conversation"),
            prompt: z.string().describe("The user prompt/message sent to the AI"),
            response: z.string().optional().describe("The AI response (can be truncated)"),
            summary: z.string().optional().describe("Brief summary of what was discussed"),
            project_id: z.number().optional().describe("Link to a project by ID"),
            project_slug: z.string().optional().describe("Link to a project by slug (alternative to project_id)"),
            category: z.enum(["general", "coding", "research", "business", "design", "writing", "debug", "planning"]).optional().default("general"),
            tags: z.array(z.string()).optional().describe("Free-form tags for the conversation"),
            ai_model: z.string().optional().describe("AI model used, e.g. 'claude-3', 'gpt-4'"),
            ai_provider: z.string().optional().describe("AI provider, e.g. 'anthropic', 'openai', 'qoder'"),
            tool_used: z.string().optional().describe("Tool/platform used, e.g. 'qoder', 'cursor', 'chatgpt-web'"),
            session_id: z.string().optional().describe("Session/thread ID from the AI tool"),
            tokens_used: z.number().optional().describe("Approximate token count"),
            duration_seconds: z.number().optional().describe("How long the interaction took"),
            outcome: z.string().optional().describe("JSON outcome object"),
            follow_up: z.string().optional().describe("Notes on what to do next"),
            is_bookmarked: z.boolean().optional().default(false),
        },
        async (params) => {
            const db = await getDb();

            // Resolve project_id from slug if provided
            let projectId = params.project_id;
            if (!projectId && params.project_slug) {
                const project = db
                    .prepare("SELECT id FROM projects WHERE slug = ?")
                    .get(params.project_slug) as any;
                if (project) {
                    projectId = project.id;
                }
            }

            const result = db
                .prepare(
                    `INSERT INTO ai_conversation_logs
                    (title, summary, prompt, response, ai_model, ai_provider, project_id, category, tags, tool_used, session_id, tokens_used, duration_seconds, outcome, follow_up, is_bookmarked)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    params.title,
                    params.summary || null,
                    params.prompt,
                    params.response || null,
                    params.ai_model || null,
                    params.ai_provider || null,
                    projectId || null,
                    params.category || "general",
                    params.tags ? JSON.stringify(params.tags) : null,
                    params.tool_used || null,
                    params.session_id || null,
                    params.tokens_used || null,
                    params.duration_seconds || null,
                    params.outcome || null,
                    params.follow_up || null,
                    params.is_bookmarked ? 1 : 0,
                );

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                success: true,
                                id: result.lastInsertRowid,
                                message: `AI conversation logged${projectId ? ` (project #${projectId})` : ""}`,
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );

    server.tool(
        "list_ai_conversations",
        "List AI conversation logs, optionally filtered by project, category, or date range",
        {
            project_id: z.number().optional().describe("Filter by project ID"),
            project_slug: z.string().optional().describe("Filter by project slug"),
            category: z.string().optional().describe("Filter by category"),
            ai_provider: z.string().optional().describe("Filter by AI provider"),
            is_bookmarked: z.boolean().optional().describe("Filter by bookmark status"),
            limit: z.number().optional().default(20),
            offset: z.number().optional().default(0),
        },
        async (params) => {
            const db = await getDb();
            const conditions: string[] = [];
            const values: any[] = [];

            if (params.project_id) {
                conditions.push("acl.project_id = ?");
                values.push(params.project_id);
            } else if (params.project_slug) {
                conditions.push("p.slug = ?");
                values.push(params.project_slug);
            }
            if (params.category) {
                conditions.push("acl.category = ?");
                values.push(params.category);
            }
            if (params.ai_provider) {
                conditions.push("acl.ai_provider = ?");
                values.push(params.ai_provider);
            }
            if (params.is_bookmarked !== undefined) {
                conditions.push("acl.is_bookmarked = ?");
                values.push(params.is_bookmarked ? 1 : 0);
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            values.push(params.limit, params.offset || 0);

            const logs = db
                .prepare(
                    `SELECT acl.*, p.name as project_name, p.slug as project_slug
                     FROM ai_conversation_logs acl
                     LEFT JOIN projects p ON acl.project_id = p.id
                     ${where}
                     ORDER BY acl.logged_at DESC
                     LIMIT ? OFFSET ?`,
                )
                .all(...values);

            const total = db
                .prepare(
                    `SELECT COUNT(*) as count
                     FROM ai_conversation_logs acl
                     LEFT JOIN projects p ON acl.project_id = p.id
                     ${where}`,
                )
                .get(...values.slice(0, -2)) as any;

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            { logs, total: total?.count || 0, limit: params.limit, offset: params.offset || 0 },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );

    server.tool(
        "get_ai_conversation",
        "Get a specific AI conversation log by ID",
        {
            id: z.number().describe("Conversation log ID"),
        },
        async (params) => {
            const db = await getDb();
            const log = db
                .prepare(
                    `SELECT acl.*, p.name as project_name, p.slug as project_slug
                     FROM ai_conversation_logs acl
                     LEFT JOIN projects p ON acl.project_id = p.id
                     WHERE acl.id = ?`,
                )
                .get(params.id);

            if (!log) {
                return { content: [{ type: "text", text: "Conversation log not found" }] };
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(log, null, 2),
                    },
                ],
            };
        },
    );

    server.tool(
        "update_ai_conversation",
        "Update an existing AI conversation log (e.g. add outcome, follow-up, bookmark)",
        {
            id: z.number().describe("Conversation log ID"),
            summary: z.string().optional(),
            response: z.string().optional(),
            category: z.string().optional(),
            tags: z.array(z.string()).optional(),
            outcome: z.string().optional(),
            follow_up: z.string().optional(),
            is_bookmarked: z.boolean().optional(),
            project_id: z.number().optional(),
        },
        async (params) => {
            const db = await getDb();
            const sets: string[] = [];
            const values: any[] = [];

            if (params.summary !== undefined) { sets.push("summary = ?"); values.push(params.summary); }
            if (params.response !== undefined) { sets.push("response = ?"); values.push(params.response); }
            if (params.category !== undefined) { sets.push("category = ?"); values.push(params.category); }
            if (params.tags !== undefined) { sets.push("tags = ?"); values.push(JSON.stringify(params.tags)); }
            if (params.outcome !== undefined) { sets.push("outcome = ?"); values.push(params.outcome); }
            if (params.follow_up !== undefined) { sets.push("follow_up = ?"); values.push(params.follow_up); }
            if (params.is_bookmarked !== undefined) { sets.push("is_bookmarked = ?"); values.push(params.is_bookmarked ? 1 : 0); }
            if (params.project_id !== undefined) { sets.push("project_id = ?"); values.push(params.project_id); }

            if (sets.length === 0) {
                return { content: [{ type: "text", text: "No fields to update" }] };
            }

            values.push(params.id);
            db.prepare(`UPDATE ai_conversation_logs SET ${sets.join(", ")} WHERE id = ?`).run(...values);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ success: true, id: params.id, updated_fields: sets.map(s => s.split(" = ")[0]) }, null, 2),
                    },
                ],
            };
        },
    );

    server.tool(
        "ai_conversation_stats",
        "Get summary statistics of AI conversation logs",
        {},
        async () => {
            const db = await getDb();

            const total = db.prepare("SELECT COUNT(*) as count FROM ai_conversation_logs").get() as any;
            const byCategory = db
                .prepare("SELECT category, COUNT(*) as count FROM ai_conversation_logs GROUP BY category ORDER BY count DESC")
                .all();
            const byProject = db
                .prepare(
                    `SELECT p.name as project_name, p.slug as project_slug, COUNT(*) as count
                     FROM ai_conversation_logs acl
                     LEFT JOIN projects p ON acl.project_id = p.id
                     GROUP BY acl.project_id
                     ORDER BY count DESC`,
                )
                .all();
            const byProvider = db
                .prepare("SELECT ai_provider, COUNT(*) as count FROM ai_conversation_logs WHERE ai_provider IS NOT NULL GROUP BY ai_provider ORDER BY count DESC")
                .all();
            const bookmarked = db
                .prepare("SELECT COUNT(*) as count FROM ai_conversation_logs WHERE is_bookmarked = 1")
                .get() as any;
            const recent = db
                .prepare(
                    `SELECT acl.id, acl.title, acl.category, acl.ai_provider, acl.logged_at, p.name as project_name
                     FROM ai_conversation_logs acl
                     LEFT JOIN projects p ON acl.project_id = p.id
                     ORDER BY acl.logged_at DESC LIMIT 5`,
                )
                .all();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                total: total.count,
                                bookmarked: bookmarked.count,
                                by_category: byCategory,
                                by_project: byProject,
                                by_provider: byProvider,
                                recent,
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );

}
