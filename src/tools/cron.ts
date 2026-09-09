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
            const job = db.prepare("SELECT * FROM cron_jobs WHERE job_type = ? ORDER BY id LIMIT 1").get(job_type) as any;
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
                            is_active: Boolean(job.is_active),
                            last_status: job.last_status,
                            last_run: job.last_run_at,
                            message: "Would run this job. Omit dry_run to execute.",
                        }, null, 2),
                    }],
                };
            }
            if (!job.is_active) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({ error: `Job is inactive in cron_jobs: ${job_type}` }),
                    }],
                };
            }

            return new Promise((fulfill) => {
                // Use the same runner as system cron. It owns registry lookup,
                // default args, DB params, per-job timeout, locking, and status
                // updates, so MCP cannot drift into a second scheduler.
                const runner = resolve(SCRIPTS_DIR, "utils", "cron_runner.py");
                execFile(PYTHON, [runner, "--run", job_type], {
                    cwd: REPO_ROOT,
                    timeout: 900_000,
                    maxBuffer: 2 * 1024 * 1024,
                }, (err: any, stdout: string, stderr: string) => {
                    const state = db.prepare(
                        "SELECT last_run_at, last_status FROM cron_jobs WHERE job_type = ? ORDER BY id LIMIT 1",
                    ).get(job_type) as any;

                    if (err) {
                        fulfill({
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    job_type,
                                    status: "failed",
                                    error: (stderr || err.message).slice(0, 500),
                                    output: stdout?.slice(0, 1000),
                                    last_run: state?.last_run_at,
                                }, null, 2),
                            }],
                        });
                    } else {
                        fulfill({
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    job_type,
                                    status: state?.last_status || "success",
                                    ran_at: state?.last_run_at,
                                    output: stdout?.slice(0, 4000),
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
