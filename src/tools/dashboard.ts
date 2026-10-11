import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { openCellStore } from "../cell-store.js";
import { ledgerSection } from "../crm-ledger.js";
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
            const revenue = await ledgerSection(async (ledger) => {
                const { rows, totals } = await ledger.revenue({ received: true, limit: 1 });
                return { totals, latest: rows[0]?.revenue_date ?? null };
            });
            const activeGoals = sortRows(
                await openCellStore("goals", "legacy-mcp", { channel: "mcp" }).list("goals", { status: ["active", "planning"] }),
                ["priority"],
            )
                .slice(0, 5)
                .map((g) => ({ title: g.title, type: g.type, progress_percent: g.progress_percent, due_date: g.due_date }));
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                profile,
                                skills: skillsStats,
                                topSkills,
                                revenue: revenue.available ? revenue.data : { available: false, reason: revenue.reason },
                                goals: activeGoals,
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
