import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb, initDb, closeDb } from "./db.js";

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
