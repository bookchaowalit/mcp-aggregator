import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerSocialTools({
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

}
