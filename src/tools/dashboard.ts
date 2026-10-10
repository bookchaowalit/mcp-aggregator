import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { openCellStore } from "../cell-store.js";
import { skillStats, sortRows, withCategory } from "../portfolio-reads.js";

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
            // Skills and goals live in the roles-skills and goals cells.
            const rolesSkills = openCellStore("roles-skills", "legacy-mcp", { channel: "mcp" });
            const allSkills = await rolesSkills.list("skills");
            const skillsStats = skillStats(allSkills);
            const topSkills = sortRows(
                withCategory(allSkills, await rolesSkills.list("skill-categories")),
                ["progress_percent", "desc"],
            )
                .slice(0, 10)
                .map((s) => ({ name: s.name, progress_percent: s.progress_percent, status: s.status, category: s.category_name }));
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
            const activeGoals = sortRows(
                await openCellStore("goals", "legacy-mcp", { channel: "mcp" }).list("goals", { status: ["active", "planning"] }),
                ["priority"],
            )
                .slice(0, 5)
                .map((g) => ({ title: g.title, type: g.type, progress_percent: g.progress_percent, due_date: g.due_date }));
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
