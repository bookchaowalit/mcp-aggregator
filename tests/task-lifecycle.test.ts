import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTasksTools } from "../src/tools/tasks.js";
import { buildTaskUpdate } from "../src/task-state.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "solo-task-lifecycle-"));
const dbPath = join(directory, "tasks.db");
const db = new Database(dbPath);
const schema = readFileSync(join(root, "infra", "database", "schema.sql"), "utf8");
db.exec(schema.slice(schema.indexOf("CREATE TABLE tasks (")).split(";", 1)[0]);
db.exec("CREATE TABLE task_role_suggestions (task_id INTEGER, role_id TEXT, review_status TEXT)");
mkdirSync(join(directory, "infra", "go", "task-sync"), { recursive: true });
const server = new McpServer({ name: "task-fixture", version: "1.0.0" });
const client = new Client({ name: "task-fixture-client", version: "1.0.0" });
registerTasksTools({ server, getDb: () => db });

before(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
});

after(async () => {
    await client.close();
    await server.close();
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
        [join(root, "infra", "node_modules", "tsx", "dist", "cli.mjs"), join(root, "infra", "cli.ts"), "tasks", ...args],
        {
            cwd: root,
            env: { ...process.env, SOLO_EMPIRE_DB_PATH: dbPath, SOLO_EMPIRE_ROOT: directory, PATH: directory },
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
    for (const mode of ["complete_task", "update_task", "cli_done", "cli_update"]) {
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
    const cli = runCli("list");
    assert.equal(cli.status, 0, cli.stderr);
    assert.ok(!cli.stdout.includes("ARCHIVED_FIXTURE_MUST_NOT_APPEAR"));
    assert.match(cli.stdout, new RegExp(`Personal: ${expected.count}`));
});

test("sync, push, and pull return nonzero when their Go runtime is unavailable", () => {
    for (const action of ["sync", "push", "pull"]) {
        const result = runCli(action);
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(`Task ${action} failed`));
        assert.ok(!result.stdout.includes("running generate only"));
    }
});

test("task entrypoint works on Windows and Unix with isolated state", () => {
    const taskResult = spawnSync("task", ["tasks", "--", "--project", "__fixture_no_match__"], {
        cwd: root,
        env: { ...process.env, SOLO_EMPIRE_DB_PATH: dbPath, SOLO_EMPIRE_ROOT: directory },
        encoding: "utf8",
        timeout: 15000,
    });
    assert.ifError(taskResult.error);
    assert.equal(taskResult.status, 0, taskResult.stderr);
    assert.match(taskResult.stdout, /No tasks/);
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
