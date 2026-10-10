import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { openCellStore } from "../cell-store.js";

// Projects live in the projects cell; conversation logs stay in SQLite and are joined here.
const projectsCell = () => openCellStore("projects", "legacy-mcp", { channel: "mcp" });
async function projectsById(logs: Array<{ project_id?: number | null }>): Promise<Map<number, { name: string; slug: string }>> {
    if (!logs.some((l) => l.project_id != null)) return new Map();
    return new Map((await projectsCell().list("projects")).map((p) => [p.id, { name: p.name, slug: p.slug }]));
}
function withProject<T extends { project_id?: number | null }>(log: T, projects: Map<number, { name: string; slug: string }>) {
    const project = log.project_id == null ? undefined : projects.get(log.project_id);
    return { ...log, project_name: project?.name ?? null, project_slug: project?.slug ?? null };
}

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
                const project = (await projectsCell().list("projects")).find((p) => p.slug === params.project_slug);
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
                // An unknown slug matches nothing, like the old join on p.slug.
                const project = (await projectsCell().list("projects")).find((p) => p.slug === params.project_slug);
                conditions.push("acl.project_id = ?");
                values.push(project?.id ?? -1);
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

            const rawLogs = db
                .prepare(
                    `SELECT acl.*
                     FROM ai_conversation_logs acl
                     ${where}
                     ORDER BY acl.logged_at DESC
                     LIMIT ? OFFSET ?`,
                )
                .all(...values) as any[];
            const projects = await projectsById(rawLogs);
            const logs = rawLogs.map((log) => withProject(log, projects));

            const total = db
                .prepare(
                    `SELECT COUNT(*) as count
                     FROM ai_conversation_logs acl
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
            const row = db
                .prepare("SELECT acl.* FROM ai_conversation_logs acl WHERE acl.id = ?")
                .get(params.id) as any;

            if (!row) {
                return { content: [{ type: "text", text: "Conversation log not found" }] };
            }
            const log = withProject(row, await projectsById([row]));

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
            const projectCounts = db
                .prepare(
                    `SELECT project_id, COUNT(*) as count
                     FROM ai_conversation_logs
                     GROUP BY project_id
                     ORDER BY count DESC`,
                )
                .all() as any[];
            const projects = await projectsById(projectCounts);
            const byProject = projectCounts.map((row) => {
                const { project_name, project_slug } = withProject(row, projects);
                return { project_name, project_slug, count: row.count };
            });
            const byProvider = db
                .prepare("SELECT ai_provider, COUNT(*) as count FROM ai_conversation_logs WHERE ai_provider IS NOT NULL GROUP BY ai_provider ORDER BY count DESC")
                .all();
            const bookmarked = db
                .prepare("SELECT COUNT(*) as count FROM ai_conversation_logs WHERE is_bookmarked = 1")
                .get() as any;
            const recentRows = db
                .prepare(
                    `SELECT acl.id, acl.title, acl.category, acl.ai_provider, acl.logged_at, acl.project_id
                     FROM ai_conversation_logs acl
                     ORDER BY acl.logged_at DESC LIMIT 5`,
                )
                .all() as any[];
            const recentProjects = await projectsById(recentRows);
            const recent = recentRows.map(({ project_id, ...row }) => ({
                ...row,
                project_name: withProject({ project_id }, recentProjects).project_name,
            }));

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
