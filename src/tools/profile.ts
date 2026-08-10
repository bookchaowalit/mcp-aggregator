import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerProfileTools({
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

}
