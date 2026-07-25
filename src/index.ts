import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb, initDb, closeDb } from "./db.js";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root: infra/mcp-server/src (or dist) -> ../../..
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCRIPTS_DIR = resolve(REPO_ROOT, "infra", "scripts");
const PYTHON = process.env.PYTHON || "python3";

/** Helper: run a Python script with --json and return parsed result */
function runPyScript(scriptPath: string, args: string[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
        const fullArgs = [scriptPath, ...args, "--json"];
        execFile(PYTHON, fullArgs, {
            cwd: REPO_ROOT,
            timeout: 30_000,
            maxBuffer: 2 * 1024 * 1024,
        }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr?.slice(0, 500) || err.message));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch {
                resolve({ raw: stdout.slice(0, 4000) });
            }
        });
    });
}

const server = new McpServer({
    name: "solo-empire",
    version: "1.0.0",
});

// =====================================================
// PROFILE TOOLS
// =====================================================

server.tool(
    "get_profile",
    "Get personal profile information for syncing with landing page",
    {},
    async () => {
        const db = await getDb();
        const profile = db.prepare("SELECT * FROM profile LIMIT 1").get();
        const socialLinks = db
            .prepare(
                "SELECT * FROM social_links WHERE is_active = 1 ORDER BY sort_order",
            )
            .all();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ profile, socialLinks }, null, 2),
                },
            ],
        };
    },
);

server.tool(
    "update_profile",
    "Update personal profile information",
    {
        name: z.string().optional(),
        title: z.string().optional(),
        bio: z.string().optional(),
        tagline: z.string().optional(),
        location: z.string().optional(),
        email: z.string().optional(),
        website: z.string().optional(),
        avatar_url: z.string().optional(),
        header_image_url: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        const existing = db
            .prepare("SELECT id FROM profile LIMIT 1")
            .get() as any;

        if (existing) {
            const fields = Object.entries(params)
                .filter(([_, v]) => v !== undefined)
                .map(([k]) => `${k} = ?`)
                .join(", ");
            if (fields) {
                const values = Object.values(params).filter(
                    (v) => v !== undefined,
                );
                db.prepare(
                    `UPDATE profile SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                ).run(...values, existing.id);
            }
        } else {
            const columns = Object.keys(params).join(", ");
            const placeholders = Object.keys(params)
                .map(() => "?")
                .join(", ");
            db.prepare(
                `INSERT INTO profile (${columns}) VALUES (${placeholders})`,
            ).run(...Object.values(params));
        }

        const updated = db.prepare("SELECT * FROM profile LIMIT 1").get();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        { success: true, profile: updated },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);

// =====================================================
// SOCIAL LINKS TOOLS
// =====================================================

server.tool(
    "get_social_links",
    "Get all social media links",
    {
        active_only: z.boolean().optional().default(true),
    },
    async (params) => {
        const db = await getDb();
        const query = params.active_only
            ? "SELECT * FROM social_links WHERE is_active = 1 ORDER BY sort_order"
            : "SELECT * FROM social_links ORDER BY sort_order";
        const links = db.prepare(query).all();
        return {
            content: [{ type: "text", text: JSON.stringify(links, null, 2) }],
        };
    },
);

server.tool(
    "add_social_link",
    "Add a new social media link",
    {
        platform: z.string(),
        url: z.string(),
        username: z.string().optional(),
        display_name: z.string().optional(),
        description: z.string().optional(),
        is_primary: z.boolean().optional(),
        sort_order: z.number().optional(),
    },
    async (params) => {
        const db = await getDb();
        const result = db
            .prepare(
                `INSERT INTO social_links (platform, url, username, display_name, description, is_primary, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                params.platform,
                params.url,
                params.username || null,
                params.display_name || null,
                params.description || null,
                params.is_primary ? 1 : 0,
                params.sort_order || 0,
            );
        const link = db
            .prepare("SELECT * FROM social_links WHERE id = ?")
            .get(result.lastInsertRowid);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, link }, null, 2),
                },
            ],
        };
    },
);

server.tool(
    "update_social_link",
    "Update an existing social link",
    {
        id: z.number(),
        url: z.string().optional(),
        username: z.string().optional(),
        display_name: z.string().optional(),
        description: z.string().optional(),
        is_primary: z.boolean().optional(),
        is_active: z.boolean().optional(),
        sort_order: z.number().optional(),
    },
    async ({ id, ...params }) => {
        const db = await getDb();
        const sets: string[] = [];
        const vals: any[] = [];
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) {
                sets.push(`${k} = ?`);
                vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
            }
        }
        if (sets.length > 0) {
            vals.push(id);
            db.prepare(
                `UPDATE social_links SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ).run(...vals);
        }
        const link = db
            .prepare("SELECT * FROM social_links WHERE id = ?")
            .get(id);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, link }, null, 2),
                },
            ],
        };
    },
);

// =====================================================
// SKILLS TOOLS
// =====================================================

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

// =====================================================
// ASSETS TOOLS
// =====================================================

server.tool(
    "get_assets",
    "Get all assets being tracked",
    {
        type: z.string().optional(),
        status: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        let query = "SELECT * FROM assets WHERE 1=1";
        const args: any[] = [];
        if (params.type) {
            query += " AND type = ?";
            args.push(params.type);
        }
        if (params.status) {
            query += " AND status = ?";
            args.push(params.status);
        }
        query += " ORDER BY created_at DESC";
        const assets = db.prepare(query).all(...args);
        const totals = db
            .prepare(
                "SELECT COUNT(*) as total, SUM(monthly_value) as total_monthly_value, SUM(revenue) as total_revenue FROM assets",
            )
            .get();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ assets, totals }, null, 2),
                },
            ],
        };
    },
);

server.tool(
    "add_asset",
    "Add a new asset to track",
    {
        name: z.string(),
        type: z.string(),
        description: z.string().optional(),
        url: z.string().optional(),
        platform: z.string().optional(),
        status: z.string().optional(),
        monthly_value: z.number().optional(),
        notes: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        const result = db
            .prepare(
                "INSERT INTO assets (name, type, description, url, platform, status, monthly_value, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
                params.name,
                params.type,
                params.description || null,
                params.url || null,
                params.platform || null,
                params.status || "planning",
                params.monthly_value || null,
                params.notes || null,
            );
        const asset = db
            .prepare("SELECT * FROM assets WHERE id = ?")
            .get(result.lastInsertRowid);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, asset }, null, 2),
                },
            ],
        };
    },
);

server.tool(
    "update_asset",
    "Update an existing asset",
    {
        id: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional(),
        platform: z.string().optional(),
        status: z.string().optional(),
        monthly_value: z.number().optional(),
        views: z.number().optional(),
        subscribers: z.number().optional(),
        revenue: z.number().optional(),
        notes: z.string().optional(),
    },
    async ({ id, ...params }) => {
        const db = await getDb();
        const sets: string[] = [];
        const vals: any[] = [];
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length > 0) {
            sets.push("updated_at = CURRENT_TIMESTAMP");
            vals.push(id);
            db.prepare(`UPDATE assets SET ${sets.join(", ")} WHERE id = ?`).run(
                ...vals,
            );
        }
        const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(id);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, asset }, null, 2),
                },
            ],
        };
    },
);

// =====================================================
// OPPORTUNITIES TOOLS
// =====================================================

server.tool(
    "get_opportunities",
    "Get AI arbitrage and market opportunities",
    {
        tier: z.number().optional(),
        status: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        let query = "SELECT * FROM opportunities WHERE 1=1";
        const args: any[] = [];
        if (params.tier) {
            query += " AND tier = ?";
            args.push(params.tier);
        }
        if (params.status) {
            query += " AND status = ?";
            args.push(params.status);
        }
        query += " ORDER BY tier ASC, total_score DESC";
        const opportunities = db.prepare(query).all(...args);
        return {
            content: [
                { type: "text", text: JSON.stringify(opportunities, null, 2) },
            ],
        };
    },
);

server.tool(
    "add_opportunity",
    "Add a new AI arbitrage opportunity",
    {
        name: z.string(),
        description: z.string().optional(),
        type: z.string(),
        tier: z.number().min(1).max(3),
        pain_level: z.number().min(1).max(5).optional(),
        budget_level: z.number().min(1).max(5).optional(),
        frequency_level: z.number().min(1).max(5).optional(),
        ai_leverage_level: z.number().min(1).max(5).optional(),
        competition_level: z.number().min(1).max(5).optional(),
        distribution_level: z.number().min(1).max(5).optional(),
        fit_level: z.number().min(1).max(5).optional(),
        target_market: z.string().optional(),
        revenue_model: z.string().optional(),
        price_range: z.string().optional(),
        notes: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        const score =
            (params.pain_level || 3) * 0.2 +
            (params.budget_level || 3) * 0.2 +
            (params.frequency_level || 3) * 0.15 +
            (params.ai_leverage_level || 3) * 0.15 +
            (params.competition_level || 3) * 0.1 +
            (params.distribution_level || 3) * 0.1 +
            (params.fit_level || 3) * 0.1;
        const result = db
            .prepare(
                "INSERT INTO opportunities (name, description, type, tier, pain_level, budget_level, frequency_level, ai_leverage_level, competition_level, distribution_level, fit_level, total_score, target_market, revenue_model, price_range, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
                params.name,
                params.description || null,
                params.type,
                params.tier,
                params.pain_level || null,
                params.budget_level || null,
                params.frequency_level || null,
                params.ai_leverage_level || null,
                params.competition_level || null,
                params.distribution_level || null,
                params.fit_level || null,
                score,
                params.target_market || null,
                params.revenue_model || null,
                params.price_range || null,
                params.notes || null,
            );
        const opp = db
            .prepare("SELECT * FROM opportunities WHERE id = ?")
            .get(result.lastInsertRowid);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        { success: true, opportunity: opp },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);

// =====================================================
// GOALS TOOLS
// =====================================================

server.tool(
    "get_goals",
    "Get goals with tasks",
    {
        type: z.string().optional(),
        status: z.string().optional(),
        category: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        let query = "SELECT * FROM goals WHERE 1=1";
        const args: any[] = [];
        if (params.type) {
            query += " AND type = ?";
            args.push(params.type);
        }
        if (params.status) {
            query += " AND status = ?";
            args.push(params.status);
        }
        if (params.category) {
            query += " AND category = ?";
            args.push(params.category);
        }
        query += " ORDER BY priority ASC, due_date ASC";
        const goals = db.prepare(query).all(...args) as any[];
        const goalsWithTasks = goals.map((g) => ({
            ...g,
            tasks: db
                .prepare(
                    "SELECT * FROM goal_tasks WHERE goal_id = ? ORDER BY sort_order",
                )
                .all(g.id),
        }));
        return {
            content: [
                { type: "text", text: JSON.stringify(goalsWithTasks, null, 2) },
            ],
        };
    },
);

server.tool(
    "add_goal",
    "Add a new goal",
    {
        title: z.string(),
        description: z.string().optional(),
        type: z.string(),
        category: z.string(),
        priority: z.number().optional(),
        start_date: z.string().optional(),
        due_date: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        const result = db
            .prepare(
                "INSERT INTO goals (title, description, type, category, priority, start_date, due_date, status, progress_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
                params.title,
                params.description || null,
                params.type,
                params.category,
                params.priority || 3,
                params.start_date || null,
                params.due_date || null,
                "planning",
                0,
            );
        const goal = db
            .prepare("SELECT * FROM goals WHERE id = ?")
            .get(result.lastInsertRowid);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, goal }, null, 2),
                },
            ],
        };
    },
);

server.tool(
    "update_goal",
    "Update a goal",
    {
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        progress_percent: z.number().min(0).max(100).optional(),
        priority: z.number().optional(),
    },
    async ({ id, ...params }) => {
        const db = await getDb();
        const sets: string[] = [];
        const vals: any[] = [];
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (params.status === "completed")
            sets.push("completed_at = CURRENT_TIMESTAMP");
        if (sets.length > 0) {
            sets.push("updated_at = CURRENT_TIMESTAMP");
            vals.push(id);
            db.prepare(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`).run(
                ...vals,
            );
        }
        const goal = db.prepare("SELECT * FROM goals WHERE id = ?").get(id);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, goal }, null, 2),
                },
            ],
        };
    },
);

// =====================================================
// JOURNAL TOOLS
// =====================================================

server.tool(
    "get_journal",
    "Get journal entries",
    {
        entry_type: z.string().optional(),
        limit: z.number().optional().default(20),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        let query = "SELECT * FROM journal WHERE 1=1";
        const args: any[] = [];
        if (params.entry_type) {
            query += " AND entry_type = ?";
            args.push(params.entry_type);
        }
        if (params.start_date) {
            query += " AND entry_date >= ?";
            args.push(params.start_date);
        }
        if (params.end_date) {
            query += " AND entry_date <= ?";
            args.push(params.end_date);
        }
        query += " ORDER BY entry_date DESC LIMIT ?";
        args.push(params.limit);
        const entries = db.prepare(query).all(...args);
        return {
            content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
        };
    },
);

server.tool(
    "add_journal_entry",
    "Add a journal entry",
    {
        title: z.string(),
        content: z.string(),
        entry_type: z.string(),
        entry_date: z.string(),
        tags: z.string().optional(),
        mood: z.number().min(1).max(5).optional(),
        energy_level: z.number().min(1).max(5).optional(),
    },
    async (params) => {
        const db = await getDb();
        const result = db
            .prepare(
                "INSERT INTO journal (title, content, entry_type, entry_date, tags, mood, energy_level) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
                params.title,
                params.content,
                params.entry_type,
                params.entry_date,
                params.tags || null,
                params.mood || null,
                params.energy_level || null,
            );
        const entry = db
            .prepare("SELECT * FROM journal WHERE id = ?")
            .get(result.lastInsertRowid);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ success: true, entry }, null, 2),
                },
            ],
        };
    },
);

// =====================================================
// REVENUE TOOLS
// =====================================================

server.tool(
    "get_revenue",
    "Get revenue records",
    {
        source_type: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        let query = "SELECT * FROM revenue WHERE 1=1";
        const args: any[] = [];
        if (params.source_type) {
            query += " AND source_type = ?";
            args.push(params.source_type);
        }
        if (params.start_date) {
            query += " AND revenue_date >= ?";
            args.push(params.start_date);
        }
        if (params.end_date) {
            query += " AND revenue_date <= ?";
            args.push(params.end_date);
        }
        query += " ORDER BY revenue_date DESC";
        const records = db.prepare(query).all(...args);
        return {
            content: [
                { type: "text", text: JSON.stringify({ records }, null, 2) },
            ],
        };
    },
);

server.tool(
    "add_revenue",
    "Add a revenue record",
    {
        source_type: z.string(),
        source_name: z.string().optional(),
        amount: z.number(),
        currency: z.string().optional().default("THB"),
        revenue_date: z.string(),
        description: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        const result = db
            .prepare(
                "INSERT INTO revenue (source_type, source_name, amount, currency, revenue_date, description) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(
                params.source_type,
                params.source_name || null,
                params.amount,
                params.currency || "THB",
                params.revenue_date,
                params.description || null,
            );
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        { success: true, id: result.lastInsertRowid },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);

// =====================================================
// DASHBOARD TOOL
// =====================================================

server.tool(
    "get_dashboard",
    "Get a comprehensive dashboard summary",
    {},
    async () => {
        const db = await getDb();
        const profile = db.prepare("SELECT * FROM profile LIMIT 1").get();
        const skillsStats = db
            .prepare(
                "SELECT COUNT(*) as total, AVG(progress_percent) as avg_progress, SUM(hours_invested) as total_hours FROM skills",
            )
            .get();
        const topSkills = db
            .prepare(
                "SELECT s.name, s.progress_percent, s.status, sc.name as category FROM skills s LEFT JOIN skill_categories sc ON s.category_id = sc.id ORDER BY s.progress_percent DESC LIMIT 10",
            )
            .all();
        const assetsStats = db
            .prepare(
                "SELECT COUNT(*) as total, SUM(monthly_value) as monthly_value, SUM(revenue) as total_revenue FROM assets",
            )
            .get();
        const activeOpportunities = db
            .prepare(
                "SELECT name, tier, status, total_score FROM opportunities WHERE status IN ('researching', 'validating', 'active') ORDER BY tier ASC, total_score DESC LIMIT 5",
            )
            .all();
        const activeGoals = db
            .prepare(
                "SELECT title, type, progress_percent, due_date FROM goals WHERE status IN ('active', 'planning') ORDER BY priority ASC LIMIT 5",
            )
            .all();
        const recentJournal = db
            .prepare(
                "SELECT title, entry_type, entry_date FROM journal ORDER BY entry_date DESC LIMIT 5",
            )
            .all();

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(
                        {
                            profile,
                            skills: skillsStats,
                            topSkills,
                            assets: assetsStats,
                            opportunities: activeOpportunities,
                            goals: activeGoals,
                            recentJournal,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    },
);

// =====================================================
// AI CONVERSATION LOG TOOLS
// =====================================================

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

// =====================================================
// TASK TOOLS — Bidirectional task management
// =====================================================

server.tool(
    "list_tasks",
    "List all tasks from the local task management system. Supports filtering by status, project, and priority.",
    {
        status: z.enum(["todo", "in_progress", "done", "blocked", "cancelled"]).optional(),
        project: z.string().optional(),
        priority: z.number().min(1).max(5).optional(),
        limit: z.number().min(1).max(100).default(50),
    },
    async (params) => {
        const db = await getDb();
        let sql = "SELECT * FROM tasks WHERE 1=1";
        const values: any[] = [];

        if (params.status) { sql += " AND status = ?"; values.push(params.status); }
        if (params.project) { sql += " AND project = ?"; values.push(params.project); }
        if (params.priority) { sql += " AND priority = ?"; values.push(params.priority); }
        sql += " ORDER BY priority ASC, created_at DESC LIMIT ?";
        values.push(params.limit);

        const tasks = db.prepare(sql).all(...values);
        return {
            content: [{ type: "text", text: JSON.stringify({ total: tasks.length, tasks }, null, 2) }],
        };
    },
);

server.tool(
    "create_task",
    "Create a new task in the local task management system. Task will be pushed to Leantime on next sync.",
    {
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Task description"),
        status: z.enum(["todo", "in_progress", "done", "blocked"]).default("todo"),
        priority: z.number().min(1).max(5).default(3).describe("1=highest, 5=lowest"),
        project: z.string().optional(),
        category: z.string().optional().describe("income, ops, learning, health, creative, admin"),
        due_date: z.string().optional().describe("Due date YYYY-MM-DD"),
        tags: z.string().optional().describe("Comma-separated tags"),
    },
    async (params) => {
        const db = await getDb();
        const tagsJson = params.tags ? JSON.stringify(params.tags.split(",").map(t => t.trim())) : null;
        const result = db.prepare(`
            INSERT INTO tasks (title, description, status, priority, project, category, due_date, tags, sync_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', datetime('now'), datetime('now'))
        `).run(
            params.title, params.description || null, params.status, params.priority,
            params.project || null, params.category || null, params.due_date || null, tagsJson
        );
        const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(result.lastInsertRowid);
        return {
            content: [{ type: "text", text: JSON.stringify({ success: true, task, message: "Task created. Run sync to push to Leantime." }, null, 2) }],
        };
    },
);

server.tool(
    "update_task",
    "Update an existing task. Changes will be pushed to Leantime on next sync.",
    {
        id: z.number().describe("Task ID"),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["todo", "in_progress", "done", "blocked", "cancelled"]).optional(),
        priority: z.number().min(1).max(5).optional(),
        project: z.string().optional(),
        due_date: z.string().optional(),
    },
    async (params) => {
        const db = await getDb();
        const { id, ...fields } = params;
        const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
        if (!existing) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Task ${id} not found` }) }] };
        }

        const updates: string[] = [];
        const values: any[] = [];
        for (const [key, val] of Object.entries(fields)) {
            if (val !== undefined) {
                updates.push(`${key} = ?`);
                values.push(val);
            }
        }
        if (updates.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
        }

        // Mark as dirty so sync pushes to external
        const newStatus = params.status || existing.status;
        const completedAt = newStatus === "done" && existing.status !== "done" ? "datetime('now')" : null;

        if (completedAt) {
            updates.push("completed_at = datetime('now')");
        }
        updates.push("sync_status = 'dirty'");
        updates.push("updated_at = datetime('now')");

        db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...values, id);
        const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
        return {
            content: [{ type: "text", text: JSON.stringify({ success: true, task: updated, message: "Task updated. Run sync to push changes." }, null, 2) }],
        };
    },
);

server.tool(
    "complete_task",
    "Mark a task as done. Will sync completion to Leantime.",
    { id: z.number().describe("Task ID") },
    async (params) => {
        const db = await getDb();
        const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.id) as any;
        if (!existing) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Task ${params.id} not found` }) }] };
        }
        db.prepare(`
            UPDATE tasks SET status = 'done', completed_at = datetime('now'),
              sync_status = 'dirty', updated_at = datetime('now')
            WHERE id = ?
        `).run(params.id);
        const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.id);
        return {
            content: [{ type: "text", text: JSON.stringify({ success: true, task: updated }, null, 2) }],
        };
    },
);

server.tool(
    "delete_task",
    "Delete a local task. If synced to Leantime, the external ticket is NOT deleted.",
    { id: z.number().describe("Task ID") },
    async (params) => {
        const db = await getDb();
        const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(params.id) as any;
        if (!task) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Task ${params.id} not found` }) }] };
        }
        db.prepare("DELETE FROM tasks WHERE id = ?").run(params.id);
        return {
            content: [{ type: "text", text: JSON.stringify({ success: true, deleted: task.title, warning: task.external_id ? "External ticket in Leantime was NOT deleted" : undefined }, null, 2) }],
        };
    },
);

server.tool(
    "task_sync_status",
    "Show task sync status — breakdown by work (Nexatech/Leantime) vs personal (Todoist/Jira/Notion), sync state, and project.",
    {},
    async () => {
        const db = await getDb();
        const total = db.prepare("SELECT COUNT(*) as c FROM tasks").get() as any;
        const byStatus = db.prepare("SELECT status, COUNT(*) as c FROM tasks GROUP BY status").all();
        const bySync = db.prepare("SELECT sync_status, COUNT(*) as c FROM tasks GROUP BY sync_status").all();
        const byProject = db.prepare("SELECT project, COUNT(*) as c FROM tasks WHERE project IS NOT NULL GROUP BY project ORDER BY c DESC").all();
        const bySource = db.prepare("SELECT external_source, COUNT(*) as c FROM tasks WHERE external_source IS NOT NULL GROUP BY external_source").all();
        const workCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE external_source = 'leantime'").get() as any).c;
        const personalCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE external_source IS NULL OR external_source != 'leantime'").get() as any).c;
        const dirty = db.prepare("SELECT id, title, sync_status, external_source FROM tasks WHERE sync_status IN ('dirty', 'conflict') ORDER BY priority").all();
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    total: total.c,
                    work_nexatech: workCount,
                    personal: personalCount,
                    by_status: byStatus,
                    by_sync: bySync,
                    by_project: byProject,
                    by_source: bySource,
                    needs_sync: dirty,
                }, null, 2),
            }],
        };
    },
);

// =====================================================
// PHASE 7: COLLABORATION TOOLS
// =====================================================

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

// =====================================================
// PHASE 8: SECURITY TOOLS
// =====================================================

server.tool(
    "show_audit_log",
    "View audit log entries — all task/system operations",
    {
        limit: z.number().optional().default(30),
        action: z.string().optional().describe("Filter by action type: create, update, delete, sync, export"),
        target_type: z.string().optional().describe("Filter by target: task, project, collaborator, system"),
    },
    async ({ limit, action, target_type }) => {
        const db = await getDb();
        let sql = "SELECT * FROM audit_log";
        const params: any[] = [];
        const conditions: string[] = [];
        if (action) { conditions.push("action = ?"); params.push(action); }
        if (target_type) { conditions.push("target_type = ?"); params.push(target_type); }
        if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(limit);
        const rows = db.prepare(sql).all(...params);
        return { content: [{ type: "text", text: JSON.stringify({ audit_log: rows, count: rows.length }, null, 2) }] };
    },
);

server.tool(
    "list_backups",
    "List database backup history",
    {
        limit: z.number().optional().default(10),
    },
    async ({ limit }) => {
        const db = await getDb();
        const rows = db.prepare("SELECT * FROM backup_history ORDER BY created_at DESC LIMIT ?").all(limit);
        return { content: [{ type: "text", text: JSON.stringify({ backups: rows }, null, 2) }] };
    },
);

server.tool(
    "show_security_events",
    "View security events — failed logins, rate limits, suspicious activity",
    {
        limit: z.number().optional().default(20),
        severity: z.enum(["info", "warning", "critical"]).optional(),
        unresolved_only: z.boolean().optional(),
    },
    async ({ limit, severity, unresolved_only }) => {
        const db = await getDb();
        let sql = "SELECT * FROM security_events";
        const params: any[] = [];
        const conditions: string[] = [];
        if (severity) { conditions.push("severity = ?"); params.push(severity); }
        if (unresolved_only) { conditions.push("resolved = 0"); }
        if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(limit);
        const rows = db.prepare(sql).all(...params);
        return { content: [{ type: "text", text: JSON.stringify({ events: rows, count: rows.length }, null, 2) }] };
    },
);

server.tool(
    "list_permissions",
    "List access permissions for collaborators",
    {
        collaborator_id: z.number().optional(),
    },
    async ({ collaborator_id }) => {
        const db = await getDb();
        const sql = collaborator_id
            ? "SELECT p.*, c.name as collaborator_name FROM access_permissions p LEFT JOIN collaborators c ON p.collaborator_id = c.id WHERE p.collaborator_id = ? AND p.is_active = 1"
            : "SELECT p.*, c.name as collaborator_name FROM access_permissions p LEFT JOIN collaborators c ON p.collaborator_id = c.id WHERE p.is_active = 1 ORDER BY c.name, p.resource_type";
        const rows = collaborator_id
            ? db.prepare(sql).all(collaborator_id)
            : db.prepare(sql).all();
        return { content: [{ type: "text", text: JSON.stringify({ permissions: rows }, null, 2) }] };
    },
);

// =====================================================
// PHASE 9: CUSTOMIZATION TOOLS
// =====================================================

server.tool(
    "list_custom_fields",
    "List custom field definitions for tasks",
    {},
    async () => {
        const db = await getDb();
        const fields = db.prepare("SELECT * FROM custom_fields ORDER BY sort_order, name").all();
        return { content: [{ type: "text", text: JSON.stringify({ custom_fields: fields }, null, 2) }] };
    },
);

server.tool(
    "list_preferences",
    "List user preferences/settings",
    {},
    async () => {
        const db = await getDb();
        const prefs = db.prepare("SELECT * FROM user_preferences ORDER BY pref_key").all();
        return { content: [{ type: "text", text: JSON.stringify({ preferences: prefs }, null, 2) }] };
    },
);

server.tool(
    "update_preference",
    "Update a user preference value",
    {
        pref_key: z.string(),
        pref_value: z.string(),
    },
    async ({ pref_key, pref_value }) => {
        const db = await getDb();
        const result = db.prepare(
            "UPDATE user_preferences SET pref_value = ?, updated_at = datetime('now') WHERE pref_key = ?"
        ).run(pref_value, pref_key);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, updated: result.changes > 0, pref_key, pref_value }) }] };
    },
);

server.tool(
    "list_task_types",
    "List custom task types/workflows",
    {},
    async () => {
        const db = await getDb();
        const types = db.prepare("SELECT * FROM task_types WHERE is_active = 1 ORDER BY sort_order").all();
        return { content: [{ type: "text", text: JSON.stringify({ task_types: types }, null, 2) }] };
    },
);

server.tool(
    "list_custom_views",
    "List saved custom views/filters",
    {},
    async () => {
        const db = await getDb();
        const views = db.prepare(
            "SELECT cv.*, c.name as owner_name FROM custom_views cv LEFT JOIN collaborators c ON cv.owner_id = c.id ORDER BY cv.name"
        ).all();
        return { content: [{ type: "text", text: JSON.stringify({ custom_views: views }, null, 2) }] };
    },
);

server.tool(
    "run_custom_view",
    "Execute a saved custom view and return matching tasks",
    {
        view_id: z.number(),
    },
    async ({ view_id }) => {
        const db = await getDb();
        const view = db.prepare("SELECT * FROM custom_views WHERE id = ?").get(view_id) as any;
        if (!view) return { content: [{ type: "text", text: JSON.stringify({ error: "View not found" }) }] };

        let filter = view.filter_criteria ? JSON.parse(view.filter_criteria) : {};
        let sql = "SELECT * FROM tasks WHERE archived_at IS NULL";
        const params: any[] = [];

        if (filter.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            sql += ` AND status IN (${statuses.map(() => "?").join(",")})`;
            params.push(...statuses);
        }
        if (filter.priority) {
            const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
            sql += ` AND priority IN (${priorities.map(() => "?").join(",")})`;
            params.push(...priorities);
        }
        if (filter.project) { sql += " AND project = ?"; params.push(filter.project); }
        if (filter.tags) {
            const tags = Array.isArray(filter.tags) ? filter.tags : [filter.tags];
            tags.forEach((t: string) => { sql += " AND tags LIKE ?"; params.push(`%${t}%`); });
        }

        // Sort
        let sort = view.sort_criteria ? JSON.parse(view.sort_criteria) : null;
        if (sort && sort.field) {
            sql += ` ORDER BY ${sort.field} ${sort.direction || "ASC"}`;
        } else {
            sql += " ORDER BY priority, due_date";
        }

        const tasks = db.prepare(sql).all(...params);
        return { content: [{ type: "text", text: JSON.stringify({ view: view.name, task_count: tasks.length, tasks }, null, 2) }] };
    },
);

// =====================================================
// PHASE 10: PERFORMANCE TOOLS
// =====================================================

server.tool(
    "db_stats",
    "Show comprehensive database statistics — size, tables, indexes, task distribution",
    {},
    async () => {
        const db = await getDb();
        const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
        const tableCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as any).c;
        const indexCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").get() as any).c;
        const taskCount = (db.prepare("SELECT COUNT(*) as c FROM tasks").get() as any).c;
        const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all();
        const byPriority = db.prepare("SELECT priority, COUNT(*) as count FROM tasks GROUP BY priority ORDER BY priority").all();
        const byProject = db.prepare("SELECT project, COUNT(*) as count FROM tasks WHERE project IS NOT NULL GROUP BY project ORDER BY count DESC LIMIT 10").all();
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    db_size_bytes: dbSize.size,
                    db_size_mb: (dbSize.size / 1024 / 1024).toFixed(2),
                    tables: tableCount,
                    indexes: indexCount,
                    total_tasks: taskCount,
                    by_status: byStatus,
                    by_priority: byPriority,
                    top_projects: byProject,
                }, null, 2),
            }],
        };
    },
);

server.tool(
    "take_perf_snapshot",
    "Take a performance snapshot — captures current DB metrics",
    {
        snapshot_type: z.string().optional().default("manual"),
    },
    async ({ snapshot_type }) => {
        const db = await getDb();
        const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
        const taskCount = (db.prepare("SELECT COUNT(*) as c FROM tasks").get() as any).c;
        const tableCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as any).c;
        const indexCount = (db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").get() as any).c;
        const metrics = JSON.stringify({ db_size: dbSize.size, tasks: taskCount, tables: tableCount, indexes: indexCount });
        db.prepare("INSERT INTO performance_snapshots (snapshot_type, metrics_json) VALUES (?, ?)").run(snapshot_type || "manual", metrics);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, snapshot_type, metrics: JSON.parse(metrics) }) }] };
    },
);

server.tool(
    "run_integrity_check",
    "Run database integrity check (PRAGMA integrity_check + foreign_key_check)",
    {},
    async () => {
        const db = await getDb();
        const integrity = db.prepare("PRAGMA integrity_check").get() as any;
        const fkIssues = db.prepare("PRAGMA foreign_key_check").all();
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    integrity: integrity.integrity_check,
                    fk_issues_count: fkIssues.length,
                    fk_issues: fkIssues.length > 0 ? fkIssues.slice(0, 10) : [],
                }, null, 2),
            }],
        };
    },
);

server.tool(
    "vacuum_db",
    "Compact the database file (VACUUM) and report size savings",
    {},
    async () => {
        const db = await getDb();
        const before = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
        db.exec("VACUUM");
        const after = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any;
        const saved = before.size - after.size;
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    before_bytes: before.size,
                    after_bytes: after.size,
                    saved_bytes: saved,
                    saved_kb: (saved / 1024).toFixed(1),
                }),
            }],
        };
    },
);

server.tool(
    "list_cache",
    "List cached entries",
    {
        include_expired: z.boolean().optional(),
    },
    async ({ include_expired }) => {
        const db = await getDb();
        const sql = include_expired
            ? "SELECT * FROM cache_entries ORDER BY created_at DESC"
            : "SELECT * FROM cache_entries WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC";
        const entries = db.prepare(sql).all();
        return { content: [{ type: "text", text: JSON.stringify({ cache_entries: entries, count: entries.length }, null, 2) }] };
    },
);

server.tool(
    "optimize_indexes",
    "Create composite indexes and run ANALYZE for query optimization",
    {},
    async () => {
        const db = await getDb();
        const created: string[] = [];
        const compositeIndexes = [
            "CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project, status)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_due_priority ON tasks(due_date, priority)",
        ];
        for (const idx of compositeIndexes) {
            db.exec(idx);
            const name = idx.match(/idx_\w+/)?.[0] || "unknown";
            created.push(name);
        }
        db.exec("ANALYZE");
        return { content: [{ type: "text", text: JSON.stringify({ success: true, indexes_created: created, analyze: true }) }] };
    },
);

server.tool(
    "list_query_stats",
    "View query performance statistics",
    {
        limit: z.number().optional().default(20),
        query_name: z.string().optional(),
    },
    async ({ limit, query_name }) => {
        const db = await getDb();
        const sql = query_name
            ? "SELECT query_name, COUNT(*) as calls, AVG(execution_time_ms) as avg_ms, MAX(execution_time_ms) as max_ms, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as errors FROM query_stats WHERE query_name = ? GROUP BY query_name"
            : "SELECT query_name, COUNT(*) as calls, AVG(execution_time_ms) as avg_ms, MAX(execution_time_ms) as max_ms, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as errors FROM query_stats GROUP BY query_name ORDER BY calls DESC LIMIT ?";
        const rows = query_name
            ? db.prepare(sql).all(query_name)
            : db.prepare(sql).all(limit);
        return { content: [{ type: "text", text: JSON.stringify({ stats: rows }, null, 2) }] };
    },
);

// =====================================================
// ANALYTICS TOOLS — wrap Python analytics scripts
// =====================================================

server.tool(
    "revenue_analytics",
    "Run revenue analytics — trends, by-source breakdown, growth rates, forecasting",
    {
        source_type: z.string().optional().describe("Filter by source type"),
        forecast: z.boolean().optional().describe("Include forecast"),
    },
    async ({ source_type, forecast }) => {
        const args: string[] = [];
        if (source_type) args.push("--source", source_type);
        if (forecast) args.push("--forecast");
        const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "revenue_analytics.py"), args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.tool(
    "habit_analytics",
    "Run habit analytics — streak data, completion rates, patterns",
    {
        habit_id: z.number().optional().describe("Filter by habit ID"),
    },
    async ({ habit_id }) => {
        const args: string[] = [];
        if (habit_id) args.push("--habit-id", String(habit_id));
        const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "habit_analytics.py"), args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.tool(
    "goal_velocity",
    "Run goal velocity analysis — progress rate, ETA, at-risk goals",
    {},
    async () => {
        const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "goal_velocity.py"));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.tool(
    "time_analytics",
    "Run time allocation analytics — hours by category, trends, productivity",
    {
        days: z.number().optional().describe("Lookback window in days"),
    },
    async ({ days }) => {
        const args: string[] = [];
        if (days) args.push("--days", String(days));
        const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "time_analytics.py"), args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

// =====================================================
// DATA FRESHNESS TOOLS
// =====================================================

server.tool(
    "check_data_freshness",
    "Check freshness of dashboard files and data directories — detect stale or missing data",
    {
        threshold_hours: z.number().optional().describe("Override default thresholds (hours)"),
    },
    async ({ threshold_hours }) => {
        const args: string[] = [];
        if (threshold_hours) args.push("--threshold", String(threshold_hours));
        const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "data_freshness.py"), args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

// =====================================================
// CRON MANAGEMENT TOOLS
// =====================================================

server.tool(
    "list_cron_jobs",
    "List all registered cron jobs with their status and schedule",
    {
        status: z.enum(["success", "failed", "pending"]).optional().describe("Filter by last status"),
        job_type: z.string().optional().describe("Filter by job type"),
    },
    async ({ status, job_type }) => {
        const db = await getDb();
        let sql = "SELECT * FROM cron_jobs WHERE 1=1";
        const params: any[] = [];
        if (status) { sql += " AND last_status = ?"; params.push(status); }
        if (job_type) { sql += " AND job_type = ?"; params.push(job_type); }
        sql += " ORDER BY last_run_at DESC";
        const jobs = db.prepare(sql).all(...params);
        const summary = db.prepare(`
            SELECT last_status, COUNT(*) as count FROM cron_jobs GROUP BY last_status
        `).all();
        return {
            content: [{
                type: "text",
                text: JSON.stringify({ jobs, summary, total: jobs.length }, null, 2),
            }],
        };
    },
);

server.tool(
    "run_cron_job",
    "Manually trigger a cron job by type",
    {
        job_type: z.string().describe("Job type to run (e.g. system_status, backup_db, revenue_autorun)"),
        dry_run: z.boolean().optional().describe("If true, only show what would be done"),
    },
    async ({ job_type, dry_run }) => {
        const db = await getDb();
        const job = db.prepare("SELECT * FROM cron_jobs WHERE job_type = ?").get(job_type) as any;
        if (!job) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown job type: ${job_type}` }) }] };
        }

        if (dry_run) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        dry_run: true,
                        job_type,
                        name: job.name,
                        schedule: job.schedule,
                        last_status: job.last_status,
                        last_run: job.last_run_at,
                        message: "Would run this job. Omit dry_run to execute.",
                    }, null, 2),
                }],
            };
        }

        // Load cron registry from JSON (generated from cron_registry.py)
        const cronRegistryPath = resolve(__dirname, '..', 'cron_registry.json');
        let JOB_SCRIPTS: Record<string, string> = {};
        try {
            const registry = JSON.parse(fs.readFileSync(cronRegistryPath, 'utf-8'));
            JOB_SCRIPTS = registry.job_scripts;
        } catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `Failed to load cron registry: ${err}` }) }] };
        }

        const script = JOB_SCRIPTS[job_type];
        if (!script) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `No script mapping for: ${job_type}` }) }] };
        }

        return new Promise((fulfill) => {
            execFile(PYTHON, [resolve(SCRIPTS_DIR, script), "--json"], {
                cwd: REPO_ROOT,
                timeout: 120_000,
                maxBuffer: 2 * 1024 * 1024,
            }, (err: any, stdout: string, stderr: string) => {
                const now = new Date().toISOString().replace("T", " ").slice(0, 19);
                const newStatus = err ? "failed" : "success";
                // Update DB
                try {
                    db.prepare("UPDATE cron_jobs SET last_run_at = ?, last_status = ? WHERE job_type = ?")
                        .run(now, newStatus, job_type);
                } catch {}

                if (err) {
                    fulfill({
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                job_type,
                                status: "failed",
                                error: (stderr || err.message).slice(0, 500),
                                output: stdout?.slice(0, 1000),
                            }, null, 2),
                        }],
                    });
                } else {
                    let parsed: any;
                    try { parsed = JSON.parse(stdout); } catch { parsed = stdout?.slice(0, 4000); }
                    fulfill({
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                job_type,
                                status: "success",
                                ran_at: now,
                                output: parsed,
                            }, null, 2),
                        }],
                    });
                }
            });
        });
    },
);

server.tool(
    "system_health",
    "Get overall system health — combines system status, cron health, data freshness, and alerts",
    {},
    async () => {
        const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "system_health.py"));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

server.tool(
    "heal_cron",
    "Run the cron self-healer — retry failed jobs, alert if still failing",
    {
        dry_run: z.boolean().optional().describe("Preview what would be retried"),
    },
    async ({ dry_run }) => {
        const args: string[] = [];
        if (dry_run) args.push("--dry-run");
        const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "cron_healer.py"), args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
);

// =====================================================
// START SERVER
// =====================================================

async function main() {
    await initDb();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Solo Empire MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
process.on("SIGINT", () => {
    closeDb();
    process.exit(0);
});
process.on("SIGTERM", () => {
    closeDb();
    process.exit(0);
});
