import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";

export function registerCronTools({
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
        "list_cron_jobs",
        "List all registered cron jobs with their status and schedule",
        {
            status: z.enum(["success", "failed", "pending"]).optional().describe("Filter by last status"),
            job_type: z.string().optional().describe("Filter by job type"),
        },
        async ({ status, job_type }) => {
            const db = await getDb();
            let sql = "SELECT * FROM cron_jobs WHERE 1=1";
            const params: any[] = [];
            if (status) { sql += " AND last_status = ?"; params.push(status); }
            if (job_type) { sql += " AND job_type = ?"; params.push(job_type); }
            sql += " ORDER BY last_run_at DESC";
            const jobs = db.prepare(sql).all(...params);
            const summary = db.prepare(`
                SELECT last_status, COUNT(*) as count FROM cron_jobs GROUP BY last_status
            `).all();
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ jobs, summary, total: jobs.length }, null, 2),
                }],
            };
        },
    );

    server.tool(
        "run_cron_job",
        "Manually trigger a cron job by type",
        {
            job_type: z.string().describe("Job type to run (e.g. system_status, backup_db, revenue_autorun)"),
            dry_run: z.boolean().optional().describe("If true, only show what would be done"),
        },
        async ({ job_type, dry_run }) => {
            const db = await getDb();
            const job = db.prepare("SELECT * FROM cron_jobs WHERE job_type = ?").get(job_type) as any;
            if (!job) {
                return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown job type: ${job_type}` }) }] };
            }

            if (dry_run) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            dry_run: true,
                            job_type,
                            name: job.name,
                            schedule: job.schedule,
                            last_status: job.last_status,
                            last_run: job.last_run_at,
                            message: "Would run this job. Omit dry_run to execute.",
                        }, null, 2),
                    }],
                };
            }

            // Load cron registry from JSON (generated from cron_registry.py)
            const cronRegistryPath = resolve(__dirname, '..', 'cron_registry.json');
            let JOB_SCRIPTS: Record<string, string> = {};
            try {
                const registry = JSON.parse(fs.readFileSync(cronRegistryPath, 'utf-8'));
                JOB_SCRIPTS = registry.job_scripts;
            } catch (err) {
                return { content: [{ type: "text", text: JSON.stringify({ error: `Failed to load cron registry: ${err}` }) }] };
            }

            const script = JOB_SCRIPTS[job_type];
            if (!script) {
                return { content: [{ type: "text", text: JSON.stringify({ error: `No script mapping for: ${job_type}` }) }] };
            }

            return new Promise((fulfill) => {
                execFile(PYTHON, [resolve(SCRIPTS_DIR, script), "--json"], {
                    cwd: REPO_ROOT,
                    timeout: 120_000,
                    maxBuffer: 2 * 1024 * 1024,
                }, (err: any, stdout: string, stderr: string) => {
                    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
                    const newStatus = err ? "failed" : "success";
                    // Update DB
                    try {
                        db.prepare("UPDATE cron_jobs SET last_run_at = ?, last_status = ? WHERE job_type = ?")
                            .run(now, newStatus, job_type);
                    } catch {}

                    if (err) {
                        fulfill({
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    job_type,
                                    status: "failed",
                                    error: (stderr || err.message).slice(0, 500),
                                    output: stdout?.slice(0, 1000),
                                }, null, 2),
                            }],
                        });
                    } else {
                        let parsed: any;
                        try { parsed = JSON.parse(stdout); } catch { parsed = stdout?.slice(0, 4000); }
                        fulfill({
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    job_type,
                                    status: "success",
                                    ran_at: now,
                                    output: parsed,
                                }, null, 2),
                            }],
                        });
                    }
                });
            });
        },
    );

    server.tool(
        "system_health",
        "Get overall system health — combines system status, cron health, data freshness, and alerts",
        {},
        async () => {
            const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "system_health.py"));
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        "heal_cron",
        "Run the cron self-healer — retry failed jobs, alert if still failing",
        {
            dry_run: z.boolean().optional().describe("Preview what would be retried"),
        },
        async ({ dry_run }) => {
            const args: string[] = [];
            if (dry_run) args.push("--dry-run");
            const result = await runPyScript(resolve(SCRIPTS_DIR, "utils", "cron_healer.py"), args);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        },
    );

}
