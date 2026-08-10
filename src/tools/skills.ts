import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerSkillsTools({
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
        "get_skills",
        "Get all skills with optional filters",
        {
            category: z.string().optional(),
            status: z.string().optional(),
            level: z.string().optional(),
            target_level: z.string().optional(),
            limit: z.number().optional().default(100),
        },
        async (params) => {
            const db = await getDb();
            let query = `SELECT s.*, sc.name as category_name FROM skills s LEFT JOIN skill_categories sc ON s.category_id = sc.id WHERE 1=1`;
            const args: any[] = [];
            if (params.category) {
                query += " AND sc.slug = ?";
                args.push(params.category);
            }
            if (params.status) {
                query += " AND s.status = ?";
                args.push(params.status);
            }
            if (params.level) {
                query += " AND s.level = ?";
                args.push(params.level);
            }
            if (params.target_level) {
                query += " AND s.target_level = ?";
                args.push(params.target_level);
            }
            query += " ORDER BY s.priority ASC, s.progress_percent DESC LIMIT ?";
            args.push(params.limit);
            const skills = db.prepare(query).all(...args);
            const stats = db
                .prepare(
                    `SELECT COUNT(*) as total, AVG(progress_percent) as avg_progress, SUM(hours_invested) as total_hours FROM skills`,
                )
                .get();
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ skills, stats }, null, 2),
                    },
                ],
            };
        },
    );

    server.tool(
        "get_skill",
        "Get a specific skill by ID or slug",
        {
            id: z.number().optional(),
            slug: z.string().optional(),
        },
        async (params) => {
            const db = await getDb();
            let skill;
            if (params.id) {
                skill = db
                    .prepare(
                        "SELECT s.*, sc.name as category_name FROM skills s LEFT JOIN skill_categories sc ON s.category_id = sc.id WHERE s.id = ?",
                    )
                    .get(params.id);
            } else if (params.slug) {
                skill = db
                    .prepare(
                        "SELECT s.*, sc.name as category_name FROM skills s LEFT JOIN skill_categories sc ON s.category_id = sc.id WHERE s.slug = ?",
                    )
                    .get(params.slug);
            }
            if (!skill)
                return { content: [{ type: "text", text: "Skill not found" }] };
            const recentLogs = db
                .prepare(
                    "SELECT * FROM progress_log WHERE skill_id = ? ORDER BY logged_at DESC LIMIT 10",
                )
                .all((skill as any).id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ skill, recentLogs }, null, 2),
                    },
                ],
            };
        },
    );

    server.tool(
        "add_skill",
        "Add a new skill to track",
        {
            name: z.string(),
            slug: z.string(),
            description: z.string().optional(),
            category_id: z.number().optional(),
            level: z.string().optional(),
            target_level: z.string().optional(),
            status: z.string().optional(),
            priority: z.number().optional(),
            progress_percent: z.number().min(0).max(100).optional(),
            notes: z.string().optional(),
        },
        async (params) => {
            const db = await getDb();
            const result = db
                .prepare(
                    `INSERT INTO skills (name, slug, description, category_id, level, target_level, status, priority, progress_percent, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    params.name,
                    params.slug,
                    params.description || null,
                    params.category_id || null,
                    params.level || null,
                    params.target_level || null,
                    params.status || "not_started",
                    params.priority || 3,
                    params.progress_percent || 0,
                    params.notes || null,
                );
            const skill = db
                .prepare("SELECT * FROM skills WHERE id = ?")
                .get(result.lastInsertRowid);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ success: true, skill }, null, 2),
                    },
                ],
            };
        },
    );

    server.tool(
        "update_skill_progress",
        "Update skill progress and optionally log activity",
        {
            id: z.number(),
            progress_percent: z.number().min(0).max(100).optional(),
            status: z.string().optional(),
            level: z.string().optional(),
            hours_invested: z.number().optional(),
            notes: z.string().optional(),
            log_activity: z.boolean().optional(),
            activity_title: z.string().optional(),
            activity_description: z.string().optional(),
            activity_type: z.string().optional(),
            hours_spent: z.number().optional(),
            what_learned: z.string().optional(),
        },
        async (params) => {
            const db = await getDb();
            const {
                id,
                log_activity,
                activity_title,
                activity_description,
                activity_type,
                hours_spent,
                what_learned,
                ...rest
            } = params;
            const current = db
                .prepare("SELECT progress_percent FROM skills WHERE id = ?")
                .get(id) as any;
            if (!current)
                return { content: [{ type: "text", text: "Skill not found" }] };

            const sets: string[] = [];
            const vals: any[] = [];
            for (const [k, v] of Object.entries(rest)) {
                if (v !== undefined) {
                    sets.push(`${k} = ?`);
                    vals.push(v);
                }
            }
            if (sets.length > 0) {
                sets.push("updated_at = CURRENT_TIMESTAMP");
                vals.push(id);
                db.prepare(`UPDATE skills SET ${sets.join(", ")} WHERE id = ?`).run(
                    ...vals,
                );
            }

            if (log_activity && activity_title) {
                db.prepare(
                    "INSERT INTO progress_log (skill_id, activity_type, title, description, hours_spent, progress_before, progress_after, what_learned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ).run(
                    id,
                    activity_type || "other",
                    activity_title,
                    activity_description || null,
                    hours_spent || null,
                    current.progress_percent,
                    rest.progress_percent ?? current.progress_percent,
                    what_learned || null,
                );
            }

            const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ success: true, skill }, null, 2),
                    },
                ],
            };
        },
    );

}
