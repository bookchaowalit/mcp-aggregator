import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerJournalTools({
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

}
