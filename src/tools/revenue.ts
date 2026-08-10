import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerRevenueTools({
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

}
