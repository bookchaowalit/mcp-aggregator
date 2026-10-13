import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTasksTools } from "../src/tools/tasks.js";
import { buildTaskUpdate } from "../src/task-state.js";
import { MCP_ROOT, opsRoot } from "../src/roots.js";
import { overrideTaskStoreForTests } from "../src/task-store.js";
import { SqliteTaskStore, TASKS_DDL, TASK_ROLE_SUGGESTIONS_DDL } from "./support/sqlite-task-store.js";

// The owner CLI (tasks done/update/list...) lives in the ops-toolkit checkout (SOLO_OPS_ROOT, default ../ops-toolkit).
// Tests that drive it skip clearly when that checkout is absent.
const opsCli = join(opsRoot(), "infra", "cli.ts");
const hasOps = existsSync(opsCli);
const skipNoOps = hasOps ? false : `ops-toolkit owner CLI not found at ${opsCli}; set SOLO_OPS_ROOT to run`;
const directory = mkdtempSync(join(tmpdir(), "solo-task-lifecycle-"));
const dbPath = join(directory, "tasks.db");
const db = new Database(dbPath);
db.exec(TASKS_DDL);
db.exec(TASK_ROLE_SUGGESTIONS_DDL);
overrideTaskStoreForTests(() => new SqliteTaskStore(db));
mkdirSync(join(directory, "infra", "go", "task-sync"), { recursive: true });
const server = new McpServer({ name: "task-fixture", version: "1.0.0" });
const client = new Client({ name: "task-fixture-client", version: "1.0.0" });
registerTasksTools({ server });

before(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
});

after(async () => {
    await client.close();
    await server.close();
    overrideTaskStoreForTests(null);
    db.close();
    rmSync(directory, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(Array.isArray(result.content));
    const text = result.content.find((item) => item.type === "text");
    assert.ok(text && typeof text.text === "string");
    return { error: result.isError === true, data: JSON.parse(text.text) };
}

function runCli(...args: string[]) {
    const result = spawnSync(
        process.execPath,
        [join(MCP_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(MCP_ROOT, "tests", "support", "run-cli-with-sqlite-tasks.ts"), "tasks", ...args],
        {
            cwd: opsRoot(),
            env: { ...process.env, SOLO_EMPIRE_DB_PATH: dbPath, SOLO_OPS_CLI: opsCli, SOLO_OPS_ROOT: directory, PATH: directory },
            encoding: "utf8",
            timeout: 15000,
        },
    );
    assert.ifError(result.error);
    return result;
}

function taskRow(id: number) {
    return db.prepare("SELECT status, progress_percent, completed_at, sync_status FROM tasks WHERE id=?").get(id) as {
        status: string; progress_percent: number; completed_at: string | null; sync_status: string;
    };
}

test("MCP completion, update-to-done, and CLI completion share the same invariant", async () => {
    for (const mode of ["complete_task", "update_task", "cli_done", "cli_update"].filter((m) => hasOps || !m.startsWith("cli_"))) {
        const created = await callTool("create_task", { title: `Fixture ${mode}` });
        const id = created.data.task.id as number;
        if (mode === "cli_done") {
            assert.equal(runCli("done", String(id)).status, 0);
        } else if (mode === "cli_update") {
            assert.equal(runCli("update", String(id), "--status", "done", "--progress", "10").status, 0);
        } else {
            assert.equal((await callTool(mode, { id, ...(mode === "update_task" ? { status: "done" } : {}) })).error, false);
        }
        const completed = taskRow(id);
        assert.equal(completed.status, "done");
        assert.equal(completed.progress_percent, 100);
        assert.ok(completed.completed_at);
        assert.equal(completed.sync_status, "dirty");
        db.prepare("UPDATE tasks SET completed_at='2020-01-01' WHERE id=?").run(id);
        await callTool("complete_task", { id });
        assert.equal(taskRow(id).completed_at, "2020-01-01");
        await callTool("update_task", { id, status: "todo" });
        assert.equal(taskRow(id).completed_at, null);
        assert.equal(taskRow(id).progress_percent, 100);
    }
});

test("creating an already completed MCP task sets completion metadata", async () => {
    const created = await callTool("create_task", { title: "Completed fixture", status: "done" });
    assert.equal(created.data.task.progress_percent, 100);
    assert.ok(created.data.task.completed_at);
});

test("CLI and MCP hide archived tasks in lists and sync summaries", async () => {
    db.prepare("INSERT INTO tasks(title, archived_at, sync_status, external_source, project) VALUES (?, '2020-01-01', 'dirty', 'todoist', ?)")
        .run("ARCHIVED_FIXTURE_MUST_NOT_APPEAR", "archived-only-project");
    const listed = await callTool("list_tasks", {});
    assert.ok(listed.data.tasks.every((row: { archived_at: string | null }) => row.archived_at === null));
    const status = await callTool("task_sync_status", {});
    const expected = db.prepare("SELECT count(*) count FROM tasks WHERE archived_at IS NULL").get() as { count: number };
    assert.equal(status.data.total, expected.count);
    assert.ok(!JSON.stringify(status.data).includes("ARCHIVED_FIXTURE_MUST_NOT_APPEAR"));
    assert.ok(!JSON.stringify(status.data).includes("archived-only-project"));
    if (hasOps) {
        const cli = runCli("list");
        assert.equal(cli.status, 0, cli.stderr);
        assert.ok(!cli.stdout.includes("ARCHIVED_FIXTURE_MUST_NOT_APPEAR"));
        assert.match(cli.stdout, new RegExp(`Personal: ${expected.count}`));
    }
});

test("sync, push, and pull return nonzero when their Go runtime is unavailable", { skip: skipNoOps }, () => {
    for (const action of ["sync", "push", "pull"]) {
        const result = runCli(action);
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(`Task ${action} failed`));
        assert.ok(!result.stdout.includes("running generate only"));
    }
});

test("task entrypoint refuses to run without the Tasks API switch (no SQLite fallback)", { skip: skipNoOps }, () => {
    const taskResult = spawnSync("task", ["tasks", "--", "--project", "__fixture_no_match__"], {
        cwd: opsRoot(),
        env: {
            ...process.env, SOLO_EMPIRE_DB_PATH: dbPath, SOLO_OPS_ROOT: directory,
            EMPIRE_CLIENT_CONFIG: join(directory, "absent-client.env"),
            SOLO_EMPIRE_TASKS_BACKEND: "", EMPIRE_TASKS_API: "",
        },
        encoding: "utf8",
        timeout: 15000,
    });
    assert.ifError(taskResult.error);
    assert.notEqual(taskResult.status, 0);
    assert.match(taskResult.stderr + taskResult.stdout, /no task backend configured/);
});

test("missing MCP tasks and empty updates are explicit tool errors", async () => {
    assert.equal((await callTool("complete_task", { id: 999999 })).error, true);
    assert.equal((await callTool("update_task", { id: 999999, title: "Missing" })).error, true);
    assert.equal((await callTool("delete_task", { id: 999999 })).error, true);
    const created = await callTool("create_task", { title: "Empty update" });
    assert.equal((await callTool("update_task", { id: created.data.task.id })).error, true);
    assert.deepEqual(buildTaskUpdate({}, "done"), { assignments: [], values: [] });
});

test("subtasks link to a parent, reuse open duplicates on request, and append notes", async () => {
    const parent = (await callTool("create_task", { title: "Parent fixture", project: "fixture" })).data.task;
    assert.equal((await callTool("create_task", { title: "Orphan", parent_task_id: 999999 })).error, true);

    const child = (await callTool("create_task", { title: "Child fixture", project: "fixture", parent_task_id: parent.id })).data;
    assert.equal(child.task.parent_task_id, parent.id);
    const retry = (await callTool("create_task", { title: "Child fixture", project: "fixture", parent_task_id: parent.id, reuse_open: true })).data;
    assert.equal(retry.reused, true);
    assert.equal(retry.task.id, child.task.id);
    const duplicate = (await callTool("create_task", { title: "Child fixture", project: "fixture", parent_task_id: parent.id })).data;
    assert.notEqual(duplicate.task.id, child.task.id);

    await callTool("complete_task", { id: child.task.id });
    await callTool("complete_task", { id: duplicate.task.id });
    const afterDone = (await callTool("create_task", { title: "Child fixture", project: "fixture", parent_task_id: parent.id, reuse_open: true })).data;
    assert.equal(afterDone.reused, undefined);

    const listed = (await callTool("list_tasks", { parent_task_id: parent.id })).data;
    assert.equal(listed.total, 3);

    await callTool("update_task", { id: parent.id, append_notes: "sha=abc123" });
    const noted = (await callTool("update_task", { id: parent.id, append_notes: "review=pass" })).data.task;
    assert.equal(noted.notes, "sha=abc123\nreview=pass");
    assert.equal((await callTool("update_task", { id: parent.id, append_notes: "  " })).error, true);
});

test("reuse_open never matches across parent, project, closed, or archived tasks", async () => {
    const create = async (args: Record<string, unknown>) => (await callTool("create_task", args)).data;
    const parentA = (await create({ title: "Reuse parent A" })).task;
    const parentB = (await create({ title: "Reuse parent B" })).task;

    const underA = (await create({ title: "Reuse child", project: "p1", parent_task_id: parentA.id })).task;
    const underB = await create({ title: "Reuse child", project: "p1", parent_task_id: parentB.id, reuse_open: true });
    assert.equal(underB.reused, undefined);
    assert.notEqual(underB.task.id, underA.id);

    const topLevel = await create({ title: "Reuse child", project: "p1", reuse_open: true });
    assert.equal(topLevel.reused, undefined);
    assert.notEqual(topLevel.task.id, underA.id);
    const topLevelAgain = await create({ title: "Reuse child", project: "p1", reuse_open: true });
    assert.equal(topLevelAgain.task.id, topLevel.task.id);

    const solo = (await create({ title: "Reuse solo" })).task;
    const soloUnderA = await create({ title: "Reuse solo", parent_task_id: parentA.id, reuse_open: true });
    assert.equal(soloUnderA.reused, undefined);
    assert.notEqual(soloUnderA.task.id, solo.id);

    const otherProject = await create({ title: "Reuse child", project: "p2", parent_task_id: parentA.id, reuse_open: true });
    assert.equal(otherProject.reused, undefined);
    const noProject = await create({ title: "Reuse child", parent_task_id: parentA.id, reuse_open: true });
    assert.equal(noProject.reused, undefined);

    const cancelled = (await create({ title: "Reuse cancelled" })).task;
    await callTool("update_task", { id: cancelled.id, status: "cancelled" });
    assert.notEqual((await create({ title: "Reuse cancelled", reuse_open: true })).task.id, cancelled.id);

    const archived = (await create({ title: "Reuse archived" })).task;
    db.prepare("UPDATE tasks SET archived_at = datetime('now') WHERE id = ?").run(archived.id);
    assert.notEqual((await create({ title: "Reuse archived", reuse_open: true })).task.id, archived.id);
    assert.equal((await callTool("create_task", { title: "Under archived", parent_task_id: archived.id })).error, true);
});

test("delete_task archives instead of deleting and says so", async () => {
    const created = (await callTool("create_task", { title: "Delete fixture", project: "del" })).data.task;
    const deleted = await callTool("delete_task", { id: created.id });
    assert.equal(deleted.error, false);
    assert.equal(deleted.data.success, true);
    assert.equal(deleted.data.deleted, "Delete fixture");
    assert.equal(deleted.data.archived, true);
    assert.match(deleted.data.message, /archived/);
    const row = db.prepare("SELECT archived_at, archive_reason FROM tasks WHERE id=?").get(created.id) as any;
    assert.ok(row.archived_at);
    assert.equal(row.archive_reason, "deleted via MCP delete_task");
    const listed = await callTool("list_tasks", { project: "del" });
    assert.equal(listed.data.total, 0);
});

test("MCP create_task keeps explicit timestamps, sync state, tags, and list ordering", async () => {
    const created = (await callTool("create_task", { title: "Row shape", tags: "a, b", priority: 2, category: "ops", due_date: "2026-10-31" })).data.task;
    const row = db.prepare("SELECT * FROM tasks WHERE id=?").get(created.id) as any;
    assert.deepEqual(created, row);
    assert.equal(row.sync_status, "local");
    assert.equal(row.tags, '["a","b"]');
    assert.equal(row.progress_percent, 0);
    assert.match(row.created_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.equal(row.created_at, row.updated_at);
    const ordered = (await callTool("list_tasks", { limit: 100 })).data.tasks as Array<{ priority: number; created_at: string }>;
    for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i - 1].priority <= ordered[i].priority);
});

test("CLI add, update, done and list run against the temp database", { skip: skipNoOps }, () => {
    const added = runCli("add", "--title", "CLI row", "--priority", "2", "--project", "cli-fixture", "--due", "2026-11-01");
    assert.equal(added.status, 0, added.stderr);
    const id = Number(/Task #(\d+) created: CLI row \(priority: 2\)/.exec(added.stdout)?.[1]);
    assert.ok(id > 0);
    assert.match(added.stdout, /Project: cli-fixture/);
    const row = db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as any;
    assert.equal(row.sync_status, "local");
    assert.equal(row.status, "todo");
    assert.equal(row.due_date, "2026-11-01");
    const child = runCli("add", "--title", "CLI child", "--parent", String(id));
    assert.match(child.stdout, /Parent: #/);
    assert.match(runCli("add", "--title", "Orphan", "--parent", "999999").stdout, /Parent task #999999 not found/);
    assert.match(runCli("update", String(id), "--title", "CLI renamed", "--progress", "40").stdout, /updated/);
    assert.deepEqual(
        db.prepare("SELECT title, progress_percent, sync_status FROM tasks WHERE id=?").get(id),
        { title: "CLI renamed", progress_percent: 40, sync_status: "dirty" },
    );
    assert.match(runCli("update", String(id)).stdout, /No fields to update/);
    assert.match(runCli("update", "999999", "--title", "x").stdout, /Task #999999 not found/);
    db.prepare("INSERT INTO task_role_suggestions (task_id, role_id, confidence, match_reason) VALUES (?, 'role-a', 'high', 'x')").run(id);
    const listed = runCli("list", "--project", "cli-fixture");
    assert.match(listed.stdout, new RegExp(`#${id} \\[P2\\] CLI renamed \\[cli-fixture\\]`));
    assert.match(listed.stdout, /Role suggestions: role-a/);
});

test("concurrent MCP requests on one task do not lose updates", async () => {
    const created = await callTool("create_task", { title: "race target", project: "race" });
    const id = created.data.task.id as number;

    // complete then reopen, fired together: the reopen must clear completed_at
    await Promise.all([
        callTool("complete_task", { id }),
        callTool("update_task", { id, status: "todo" }),
    ]);
    const reopened = taskRow(id);
    assert.equal(reopened.status, "todo");
    assert.equal(reopened.completed_at, null);

    // concurrent note appends must all be kept
    await Promise.all(["note-a", "note-b", "note-c"].map((append_notes) => callTool("update_task", { id, append_notes })));
    const notes = (db.prepare("SELECT notes FROM tasks WHERE id=?").get(id) as { notes: string }).notes.split("\n").sort();
    assert.deepEqual(notes, ["note-a", "note-b", "note-c"]);
});

test("concurrent create_task with reuse_open creates one row", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () =>
        callTool("create_task", { title: "reuse race", project: "race2", reuse_open: true })));
    assert.equal(results.filter((r) => r.data.reused === true).length, 4);
    const count = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE title='reuse race' AND project='race2'").get() as { c: number };
    assert.equal(count.c, 1);
});
