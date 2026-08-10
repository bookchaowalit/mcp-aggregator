import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerDashboardTools({
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

}
