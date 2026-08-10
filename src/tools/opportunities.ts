import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerOpportunitiesTools({
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

}
