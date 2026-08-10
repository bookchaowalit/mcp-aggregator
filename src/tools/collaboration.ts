import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerCollaborationTools({
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
        "list_collaborators",
        "List all collaborators/team members",
        {
            include_inactive: z.boolean().optional().describe("Include inactive collaborators"),
        },
        async ({ include_inactive }) => {
            const db = await getDb();
            const sql = include_inactive
                ? "SELECT * FROM collaborators ORDER BY role, name"
                : "SELECT * FROM collaborators WHERE is_active = 1 ORDER BY role, name";
            const collabs = db.prepare(sql).all();
            return { content: [{ type: "text", text: JSON.stringify({ collaborators: collabs }, null, 2) }] };
        },
    );

    server.tool(
        "add_collaborator",
        "Add a new collaborator/team member",
        {
            name: z.string(),
            email: z.string().optional(),
            role: z.enum(["owner", "admin", "member", "viewer"]).optional().default("member"),
            avatar_url: z.string().optional(),
        },
        async ({ name, email, role, avatar_url }) => {
            const db = await getDb();
            const result = db.prepare(
                "INSERT INTO collaborators (name, email, role, avatar_url) VALUES (?, ?, ?, ?)"
            ).run(name, email || null, role || "member", avatar_url || null);
            return { content: [{ type: "text", text: JSON.stringify({ success: true, id: result.lastInsertRowid, name, role }) }] };
        },
    );

    server.tool(
        "list_activity",
        "Recent activity feed — all changes to tasks, comments, assignments",
        {
            limit: z.number().optional().default(20),
            target_type: z.string().optional().describe("Filter by target type: task, comment, shared_list, collaborator"),
        },
        async ({ limit, target_type }) => {
            const db = await getDb();
            const sql = target_type
                ? "SELECT a.*, c.name as actor_name FROM activity_feed a LEFT JOIN collaborators c ON a.collaborator_id = c.id WHERE a.target_type = ? ORDER BY a.created_at DESC LIMIT ?"
                : "SELECT a.*, c.name as actor_name FROM activity_feed a LEFT JOIN collaborators c ON a.collaborator_id = c.id ORDER BY a.created_at DESC LIMIT ?";
            const rows = target_type
                ? db.prepare(sql).all(target_type, limit)
                : db.prepare(sql).all(limit);
            return { content: [{ type: "text", text: JSON.stringify({ activity: rows, count: rows.length }, null, 2) }] };
        },
    );

    server.tool(
        "list_shared_lists",
        "List shared/curated task lists",
        {},
        async () => {
            const db = await getDb();
            const lists = db.prepare(
                "SELECT sl.*, c.name as owner_name FROM shared_lists sl LEFT JOIN collaborators c ON sl.owner_id = c.id WHERE sl.is_active = 1 ORDER BY sl.name"
            ).all();
            return { content: [{ type: "text", text: JSON.stringify({ shared_lists: lists }, null, 2) }] };
        },
    );

    server.tool(
        "create_shared_list",
        "Create a shared task list (dynamic with filters or static with manual task IDs)",
        {
            name: z.string(),
            description: z.string().optional(),
            visibility: z.enum(["private", "team", "public"]).optional().default("private"),
            list_type: z.enum(["dynamic", "static"]).optional().default("dynamic"),
            filter_criteria: z.string().optional().describe("JSON filter for dynamic lists"),
            task_ids: z.string().optional().describe("JSON array of task IDs for static lists"),
        },
        async ({ name, description, visibility, list_type, filter_criteria, task_ids }) => {
            const db = await getDb();
            const result = db.prepare(
                "INSERT INTO shared_lists (name, description, visibility, list_type, filter_criteria, task_ids) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(name, description || null, visibility || "private", list_type || "dynamic", filter_criteria || null, task_ids || "[]");
            return { content: [{ type: "text", text: JSON.stringify({ success: true, id: result.lastInsertRowid, name, list_type }) }] };
        },
    );

}
