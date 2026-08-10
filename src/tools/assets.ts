import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerAssetsTools({
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

}
