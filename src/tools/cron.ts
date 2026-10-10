import { z } from "zod";
import { resolve } from "path";
import type { ToolContext } from "../tool-context.js";
import { openCellStore } from "../cell-store.js";

function cronJobs() {
    return openCellStore("automation", "legacy-mcp", { channel: "mcp" });
}

function unavailable(error: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `automation API unavailable: ${(error as Error).message}` }) }] };
}

export function registerCronTools({
    server,
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
            let all;
            try {
                all = await cronJobs().list("cron-jobs");
            } catch (error) {
                return unavailable(error);
            }
            const jobs = all
                .filter((job) => (!status || job.last_status === status) && (!job_type || job.job_type === job_type))
                .sort((x, y) => (x.last_run_at == null ? 1 : 0) - (y.last_run_at == null ? 1 : 0)
                    || (Date.parse(String(y.last_run_at ?? "")) || 0) - (Date.parse(String(x.last_run_at ?? "")) || 0));
            const counts = new Map<string | null, number>();
            for (const job of all) counts.set(job.last_status ?? null, (counts.get(job.last_status ?? null) ?? 0) + 1);
            const summary = [...counts].map(([last_status, count]) => ({ last_status, count }));
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
            const jobsCell = (() => { try { return cronJobs(); } catch (error) { return error; } })();
            if (jobsCell instanceof Error) return unavailable(jobsCell);
            const lookup = async () => (await (jobsCell as ReturnType<typeof cronJobs>).list("cron-jobs", { job_type }))
                .sort((x, y) => x.id - y.id)[0] as any;
            let job;
            try {
                job = await lookup();
            } catch (error) {
                return unavailable(error);
            }
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
                }, async (err: any, stdout: string, stderr: string) => {
                    const state = await lookup().catch(() => undefined);

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
