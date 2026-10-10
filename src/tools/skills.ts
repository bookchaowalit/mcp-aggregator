import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { openCellStore } from "../cell-store.js";
import { skillStats, sortRows, withCategory } from "../portfolio-reads.js";

// Skills and their categories live in the roles-skills cell; progress_log stays in SQLite.
const rolesSkills = () => openCellStore("roles-skills", "legacy-mcp", { channel: "mcp" });

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
            const cell = rolesSkills();
            const filters: Record<string, string> = {};
            if (params.status) filters.status = params.status;
            if (params.level) filters.level = params.level;
            if (params.target_level) filters.target_level = params.target_level;
            const allSkills = await cell.list("skills");
            const categories = await cell.list("skill-categories");
            const matching = await cell.list("skills", filters);
            let joined = withCategory(matching, categories);
            if (params.category) joined = joined.filter((s) => s.category_slug === params.category);
            const skills = sortRows(joined, ["priority"], ["progress_percent", "desc"])
                .slice(0, params.limit)
                .map(({ category_slug, ...skill }) => skill);
            const stats = skillStats(allSkills);
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
            const cell = rolesSkills();
            let skill: any;
            if (params.id) {
                skill = await cell.get("skills", params.id);
            } else if (params.slug) {
                skill = (await cell.list("skills")).find((s) => s.slug === params.slug);
            }
            if (skill) {
                const category = skill.category_id == null ? null : await cell.get("skill-categories", skill.category_id);
                skill = { ...skill, category_name: category?.name ?? null };
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
            const skill = await rolesSkills().create("skills", {
                name: params.name,
                slug: params.slug,
                description: params.description || null,
                category_id: params.category_id || null,
                level: params.level || null,
                target_level: params.target_level || null,
                status: params.status || "not_started",
                priority: params.priority || 3,
                progress_percent: params.progress_percent || 0,
                notes: params.notes || null,
            });
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
            const cell = rolesSkills();
            const current = await cell.get("skills", id);
            if (!current)
                return { content: [{ type: "text", text: "Skill not found" }] };

            const fields: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(rest)) {
                if (v !== undefined) fields[k] = v;
            }
            const skill = Object.keys(fields).length > 0 ? await cell.update("skills", id, fields) : current;

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
