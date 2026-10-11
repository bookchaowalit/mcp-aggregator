import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
    ApiTaskStore,
    automationToken,
    clientSettings,
    legacyTaskRow,
    legacyTaskTypeRow,
    openTaskStore,
    overrideTaskStoreForTests,
    sqlLike,
    type FetchLike,
} from "../src/task-store.js";
import { SqliteTaskStore, TASKS_DDL } from "./support/sqlite-task-store.js";
import { planTaskUpdate, updateTask } from "../src/task-state.js";
import { registerCustomizationTools } from "../src/tools/customization.js";


function fixture() {
    const db = new Database(":memory:");
    db.exec(TASKS_DDL);
    db.exec(`CREATE TABLE task_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL,
        assignee_type TEXT DEFAULT 'user', assignee_id TEXT NOT NULL, assignee_name TEXT, assignment_type TEXT DEFAULT 'assigned')`);
    db.exec(`CREATE TABLE task_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT,
        icon TEXT, color TEXT, default_status TEXT DEFAULT 'todo', allowed_statuses TEXT, custom_template TEXT,
        is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TABLE custom_views (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, filter_criteria TEXT,
        sort_criteria TEXT)`);
    const insert = db.prepare(`INSERT INTO tasks (title, description, status, priority, project, tags, category, due_date,
        external_source, archived_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run("Alpha 100%", "first", "todo", 2, "p1", '["a","b"]', "ops", "2026-10-01", null, null, "2026-09-01 10:00:00");
    insert.run("beta_task", null, "done", 1, "p1", null, "ops", "2026-10-20", "leantime", null, "2026-09-02 10:00:00");
    insert.run("Gamma", "Has ALPHA text", "blocked", 2, "p2", "x,y", null, null, null, null, "2026-09-03 10:00:00");
    insert.run("Delta", null, "in_progress", 5, null, '["a"]', "learning", "2026-10-05", "notion", null, "2026-09-04 10:00:00");
    insert.run("Archived", null, "todo", 3, "p1", null, "ops", "2026-09-30", null, "2026-09-10 00:00:00", "2026-09-05 10:00:00");
    db.prepare("INSERT INTO task_assignments (task_id, assignee_type, assignee_id, assignee_name) VALUES (?, ?, ?, ?)")
        .run(1, "role", "r1", "Role One");
    db.prepare("INSERT INTO task_assignments (task_id, assignee_type, assignee_id, assignment_type) VALUES (?, ?, ?, ?)")
        .run(2, "user", "u1", "cc");
    const type = db.prepare("INSERT INTO task_types (name, allowed_statuses, is_active, sort_order) VALUES (?, ?, ?, ?)");
    type.run("zeta", '["todo","done"]', 1, 2);
    type.run("alpha", null, 1, 2);
    type.run("off", null, 0, 1);
    type.run("first", null, 1, 0);
    return db;
}

test("sqlite backend list matches the old SELECT * queries", async () => {
    const db = fixture();
    const store = new SqliteTaskStore(db);
    const rows = (await store.list()).map(legacyTaskRow);
    assert.deepEqual(rows, db.prepare("SELECT * FROM tasks WHERE archived_at IS NULL ORDER BY id").all());
    assert.deepEqual((await store.list({ include_archived: true })).map((t) => t.id), [1, 2, 3, 4, 5]);
    assert.deepEqual((await store.list({ project: "p1", status: ["todo", "done"] })).map((t) => t.id), [1, 2]);
    assert.deepEqual((await store.list({ no_external_source: true })).map((t) => t.id), [1, 3]);
    assert.deepEqual((await store.list({ priority_max: 2, due_before: "2026-10-10" })).map((t) => t.id), [1]);
    assert.deepEqual((await store.list({ numbers: [] })).length, 0);
    assert.deepEqual((await store.list({ q: "alpha" })).map((t) => t.id), [1, 3]);
    assert.deepEqual((await store.list({ q: "%" })).map((t) => t.id), [1]); // wildcards literal in the adapter
    await assert.rejects(store.list({ bogus: 1 } as any), /unknown task filters/);
});

test("sqlite backend stats matches the old GROUP BY queries", async () => {
    const db = fixture();
    const store = new SqliteTaskStore(db);
    const old = (column: string, where: string) =>
        (db.prepare(`SELECT ${column} AS k, COUNT(*) AS c FROM tasks ${where} GROUP BY ${column} ORDER BY ${column}`).all() as any[])
            .map((r) => ({ key: r.k === null ? null : String(r.k), count: r.c }));
    for (const group of ["status", "priority", "project", "category"] as const) {
        assert.deepEqual((await store.stats(group)).groups, old(group, "WHERE archived_at IS NULL"));
        assert.deepEqual((await store.stats(group, { include_archived: true })).groups, old(group, ""));
    }
    assert.equal((await store.stats()).total, 4);
    assert.equal((await store.stats(null, { include_archived: true })).total, 5);
});

test("sqlite backend assignments and task types match the old queries", async () => {
    const db = fixture();
    const store = new SqliteTaskStore(db);
    assert.deepEqual(await store.assignments({ assignee_type: "role", assignee_id: "r1" }), [
        { task: 1, assignee_type: "role", assignee_id: "r1", assignee_name: "Role One", assignment_type: "assigned" },
    ]);
    assert.equal((await store.assignments()).length, 2);
    const types = await store.taskTypes();
    assert.deepEqual(types.map((t) => t.name), ["first", "alpha", "zeta"]);
    assert.deepEqual(
        types.map(legacyTaskTypeRow),
        (db.prepare("SELECT * FROM task_types WHERE is_active = 1 ORDER BY sort_order, name").all()),
    );
    assert.equal((await store.taskTypes({ includeInactive: true })).length, 4);
});

test("sqlLike behaves like SQLite LIKE", () => {
    const db = new Database(":memory:");
    const cases: Array<[string | null, string]> = [
        ["Alpha 100%", "%alpha%"], ["Alpha", "al_ha"], ["Alpha", "al%"], ["Alpha", "pha"], [null, "%"], ["a\nb", "a%b"],
        ['["a","b"]', '%"a"%'], ["x.y", "x.y"], ["xzy", "x.y"],
    ];
    for (const [value, pattern] of cases) {
        const expected = db.prepare("SELECT ? LIKE ? AS m").get(value, pattern) as any;
        assert.equal(sqlLike(value, pattern), expected.m === 1, `${value} LIKE ${pattern}`);
    }
});

function mockFetch(responses: Array<any>) {
    const calls: Array<{ url: string; headers: Record<string, string>; method: string }> = [];
    const fetch: FetchLike = async (url, init) => {
        calls.push({ url, headers: init.headers, method: init.method });
        const body = responses.shift();
        return { ok: true, status: 200, json: async () => body };
    };
    return { calls, fetch };
}

const apiTask = (number: number, extra: Record<string, unknown> = {}) => ({
    id: `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`, number, title: `T${number}`, status: "todo",
    priority: 3, due_date: "2026-10-01", tags: ["a"], parent_number: null, ...extra,
});

test("api backend builds list requests with auth, filters and cursor pagination", async () => {
    const first = Array.from({ length: 200 }, (_, i) => apiTask(i + 1));
    const { calls, fetch } = mockFetch([{ items: first }, { items: [apiTask(201, { parent_number: 7 })] }]);
    const store = openTaskStore("dashboard-api", {
        channel: "dashboard", fetch,
        env: { SOLO_EMPIRE_TASKS_BACKEND: "api", EMPIRE_TASKS_API: "https://tasks.test:3601/", EMPIRE_AUTOMATION_TOKEN_DASHBOARD_API: "tok" },
    });
    const tasks = await store.list({ project: "p 1", status: ["todo", "done"], include_archived: true, priority_max: 2 });
    assert.equal(tasks.length, 201);
    assert.equal(tasks[200].id, 201);
    assert.equal(tasks[200].parent_task_id, 7);
    assert.deepEqual(tasks[0].tags, ["a"]);
    assert.equal(calls.length, 2);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://tasks.test:3601/v1/tasks");
    assert.deepEqual(url.searchParams.getAll("status"), ["todo", "done"]);
    assert.equal(url.searchParams.get("project"), "p 1");
    assert.equal(url.searchParams.get("include_archived"), "true");
    assert.equal(url.searchParams.get("priority_max"), "2");
    assert.equal(url.searchParams.get("limit"), "200");
    assert.equal(url.searchParams.get("after"), null);
    assert.equal(new URL(calls[1].url).searchParams.get("after"), "200");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].headers.Authorization, "Bearer tok");
    assert.equal(calls[0].headers["X-Empire-Channel"], "dashboard");
    // legacy row from an API record has the table's columns, SQLite-only ones null
    const legacy = legacyTaskRow(tasks[0]);
    assert.equal(legacy.tags, '["a"]');
    assert.equal(legacy.md_hash, null);
    assert.equal(legacy.id, 1);
});

test("api backend stats, assignments and task types use the contract endpoints", async () => {
    const { calls, fetch } = mockFetch([
        { total: 3, groups: [{ key: "2", count: 1 }, { key: "1", count: 2 }, { key: null, count: 0 }] },
        { items: [{ task_number: 4, assignee_type: "identity", assignee_ref: "u1", assignee_name: null, assignment_type: "cc" }] },
        { items: [{ number: 9, name: "n", description: null, icon: null, color: null, default_status: "todo",
            allowed_statuses: ["todo"], is_active: true, sort_order: 1 }] },
    ]);
    const store = new ApiTaskStore("http://x", "t", { fetch });
    const stats = await store.stats("priority", { include_archived: true });
    assert.deepEqual(stats, { total: 3, groups: [{ key: null, count: 0 }, { key: "1", count: 2 }, { key: "2", count: 1 }] });
    let url = new URL(calls[0].url);
    assert.equal(url.pathname, "/v1/tasks/stats");
    assert.equal(url.searchParams.get("group_by"), "priority");
    assert.equal(url.searchParams.get("include_archived"), "true");

    const assignments = await store.assignments({ assignee_type: "user", assignee_id: "u1", task: 4 });
    assert.deepEqual(assignments, [{ task: 4, assignee_type: "user", assignee_id: "u1", assignee_name: null, assignment_type: "cc" }]);
    url = new URL(calls[1].url);
    assert.equal(url.pathname, "/v1/task-assignments");
    assert.equal(url.searchParams.get("assignee_type"), "identity");
    assert.equal(url.searchParams.get("assignee_ref"), "u1");
    assert.equal(url.searchParams.get("task"), "4");
    assert.equal(url.searchParams.get("offset"), "0");

    const types = await store.taskTypes({ includeInactive: true });
    assert.equal(new URL(calls[2].url).pathname, "/v1/task-types");
    assert.equal(new URL(calls[2].url).searchParams.get("include_inactive"), "true");
    assert.deepEqual(types.map(legacyTaskTypeRow)[0].allowed_statuses, '["todo"]');
    assert.equal(types[0].id, 9);
});

test("api backend maps errors and refuses to guess a missing token", async () => {
    const failing: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({ detail: { reason: "forbidden" } }) });
    await assert.rejects(new ApiTaskStore("http://x", "t", { fetch: failing }).list(), /403: forbidden/);
    assert.throws(
        () => openTaskStore("no-such-automation", { env: { SOLO_EMPIRE_TASKS_BACKEND: "api" } }),
        /no token for automation/,
    );
    assert.throws(() => openTaskStore("x", { env: { SOLO_EMPIRE_TASKS_BACKEND: "nope" } }), /unknown SOLO_EMPIRE_TASKS_BACKEND/);
    assert.throws(() => openTaskStore("x", { env: { SOLO_EMPIRE_TASKS_BACKEND: "sqlite" } }), /retired on 2026-10-09/);
    assert.throws(() => openTaskStore("x", { env: { EMPIRE_CLIENT_CONFIG: "/nonexistent/client.env" } }), /no task backend configured/);
});

async function mcp(db: Database.Database) {
    const server = new McpServer({ name: "fixture", version: "1.0.0" });
    const client = new Client({ name: "fixture-client", version: "1.0.0" });
    overrideTaskStoreForTests(() => new SqliteTaskStore(db)); // callers reset it with overrideTaskStoreForTests(null)
    const context: any = { server };
    registerCustomizationTools(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as any[]).find((item) => item.type === "text");
        return JSON.parse(text.text);
    };
}

test("MCP list_task_types keeps its old output", async () => {
    const db = fixture();
    const call = await mcp(db);
    after(() => overrideTaskStoreForTests(null));

    assert.deepEqual((await call("list_task_types")).task_types,
        db.prepare("SELECT * FROM task_types WHERE is_active = 1 ORDER BY sort_order, name").all());
});

test("sqlite backend writes: get, create, update, complete, archive, unarchive", async () => {
    const db = fixture();
    const store = new SqliteTaskStore(db);
    assert.equal((await store.get(999)), null);
    assert.equal((await store.get(5))?.archived_at, "2026-09-10 00:00:00"); // archived tasks are readable
    const number = await store.create({ title: "New", priority: 2, tags: ["x", "y"], parent_task_id: 1 }, { legacy: { sync_status: "local" } });
    assert.equal(number, 6);
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(number) as any;
    assert.equal(row.status, "todo");
    assert.equal(row.tags, '["x","y"]');
    assert.equal(row.parent_task_id, 1);
    assert.equal(row.sync_status, "local");
    assert.match(row.created_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    await assert.rejects(store.create({ bogus: 1 } as any), /unknown task fields/);
    await assert.rejects(store.update(1, { parent_task_id: 2 } as any), /unknown task fields/);
    await assert.rejects(store.update(1, {}, { legacy: { "x; DROP": 1 } }), /invalid legacy column/);

    await store.update(number, { title: "Renamed", priority: 1 }, { legacy: { sync_status: "dirty" } });
    let after = db.prepare("SELECT title, priority, sync_status, completed_at FROM tasks WHERE id = ?").get(number) as any;
    assert.deepEqual(after, { title: "Renamed", priority: 1, sync_status: "dirty", completed_at: null });

    await store.update(number, { status: "done" }, { legacy: { progress_percent: 100 } }); // done goes through complete
    after = db.prepare("SELECT status, progress_percent, completed_at FROM tasks WHERE id = ?").get(number) as any;
    assert.equal(after.status, "done");
    assert.equal(after.progress_percent, 100);
    assert.ok(after.completed_at);
    db.prepare("UPDATE tasks SET completed_at = '2020-01-01' WHERE id = ?").run(number);
    await store.complete(number);
    assert.equal((db.prepare("SELECT completed_at FROM tasks WHERE id = ?").get(number) as any).completed_at, "2020-01-01");
    await store.complete(number, { legacy: { completed_at: "2021-02-03 04:05:06" } });
    assert.equal((db.prepare("SELECT completed_at FROM tasks WHERE id = ?").get(number) as any).completed_at, "2021-02-03 04:05:06");

    await store.archive(number, "because");
    const archived = db.prepare("SELECT archived_at, archive_reason FROM tasks WHERE id = ?").get(number) as any;
    assert.ok(archived.archived_at);
    assert.equal(archived.archive_reason, "because");
    const firstStamp = archived.archived_at;
    db.prepare("UPDATE tasks SET archived_at = '2020-05-05 00:00:00' WHERE id = ?").run(number);
    await store.archive(number, "again"); // keeps the first archived_at
    assert.equal((db.prepare("SELECT archived_at FROM tasks WHERE id = ?").get(number) as any).archived_at, "2020-05-05 00:00:00");
    assert.ok(firstStamp);
    assert.ok(!(await store.list()).some((t) => t.id === number));
    await store.unarchive(number);
    assert.deepEqual(db.prepare("SELECT archived_at, archive_reason FROM tasks WHERE id = ?").get(number), { archived_at: null, archive_reason: null });
    assert.equal(db.prepare("SELECT count(*) AS c FROM tasks").get().c, 6); // nothing was deleted
});

test("planTaskUpdate and updateTask keep the old buildTaskUpdate rules", async () => {
    assert.equal(planTaskUpdate({}, { status: "todo", notes: null }), null);
    assert.equal(planTaskUpdate({ append_notes: "  " }, { status: "todo", notes: null }), null);
    assert.deepEqual(planTaskUpdate({ progress_percent: 10 }, { status: "done", notes: null }), {
        fields: { status: "done" }, legacy: { sync_status: "dirty", progress_percent: 100 },
    });
    assert.deepEqual(planTaskUpdate({ status: "todo", title: "t" }, { status: "done", notes: "n" })?.legacy, { sync_status: "dirty", completed_at: null });
    assert.equal(planTaskUpdate({ append_notes: "b" }, { status: "todo", notes: "a" })?.fields.notes, "a\nb");
    assert.equal(planTaskUpdate({ append_notes: "b" }, { status: "todo", notes: "" })?.fields.notes, "b");

    const db = fixture();
    const store = new SqliteTaskStore(db);
    assert.equal(await updateTask(store, 999, { title: "x" }), "missing");
    assert.equal(await updateTask(store, 1, {}), "empty");
    assert.equal(await updateTask(store, 1, { status: "done", progress_percent: 5, title: "Done now" }), "updated");
    const row = db.prepare("SELECT title, status, progress_percent, completed_at, sync_status FROM tasks WHERE id = 1").get() as any;
    assert.deepEqual({ ...row, completed_at: Boolean(row.completed_at) },
        { title: "Done now", status: "done", progress_percent: 100, completed_at: true, sync_status: "dirty" });
    await updateTask(store, 1, { status: "todo" });
    assert.equal((db.prepare("SELECT completed_at FROM tasks WHERE id = 1").get() as any).completed_at, null);
});

function recordingFetch(responses: Array<{ status?: number; body?: any }>) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
    const fetch: FetchLike = async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
        const next = responses.shift() ?? {};
        const status = next.status ?? 200;
        return { ok: status < 400, status, json: async () => { if (next.body === undefined) throw new Error("empty"); return next.body; } };
    };
    return { calls, fetch };
}

test("api backend writes: create, update, complete, archive, unarchive, get", async () => {
    const parent = apiTask(1);
    const child = apiTask(7);
    const { calls, fetch } = recordingFetch([
        { body: parent }, // parent lookup for create
        { status: 201, body: child }, // POST /v1/tasks
        { body: { ...child, status: "blocked" } }, // PATCH status
        {}, // PATCH body
        {}, // POST complete
        {}, // POST archive
        {}, // POST unarchive
        { status: 404, body: { detail: { reason: "not_found" } } },
        { body: apiTask(9, { archived_at: "2026-01-01T00:00:00Z" }) },
    ]);
    const store = openTaskStore("owner-cli", {
        channel: "cli", fetch,
        env: { SOLO_EMPIRE_TASKS_BACKEND: "api", EMPIRE_TASKS_API: "https://t:1", EMPIRE_AUTOMATION_TOKEN_OWNER_CLI: "tok" },
    });
    const number = await store.create(
        { title: "C", status: "blocked", tags: "a, b", due_date: "2026-10-09T10:00:00", parent_task_id: 1, priority: 2 },
        { legacy: { sync_status: "local" } },
    );
    assert.equal(number, 7);
    assert.equal(calls[0].url, "https://t:1/v1/tasks/number/1");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[1].url, "https://t:1/v1/tasks");
    assert.deepEqual(calls[1].body, { title: "C", tags: ["a", "b"], due_date: "2026-10-09", parent_task_id: parent.id, priority: 2 });
    assert.equal(calls[1].headers.Authorization, "Bearer tok");
    assert.equal(calls[1].headers["X-Empire-Channel"], "cli");
    assert.equal(calls[1].headers["Content-Type"], "application/json");
    assert.equal(calls[2].method, "PATCH");
    assert.equal(calls[2].url, `https://t:1/v1/tasks/${child.id}`);
    assert.deepEqual(calls[2].body, { status: "blocked" });

    await store.update(7, { status: "done", title: "T" }, { legacy: { sync_status: "dirty" } });
    assert.equal(calls[3].method, "PATCH");
    assert.deepEqual(calls[3].body, { title: "T" }); // PATCH never carries status=done, legacy never sent
    assert.equal(calls[4].method, "POST");
    assert.equal(calls[4].url, `https://t:1/v1/tasks/${child.id}/complete`);
    assert.equal(calls[4].body, undefined);

    await store.archive(7, "deleted via MCP delete_task");
    assert.equal(calls[5].url, `https://t:1/v1/tasks/${child.id}/archive`);
    assert.deepEqual(calls[5].body, { reason: "deleted via MCP delete_task" });
    await store.unarchive(7);
    assert.equal(calls[6].url, `https://t:1/v1/tasks/${child.id}/unarchive`);
    assert.ok(calls.every((call) => call.method !== "DELETE"));

    assert.equal(await store.get(8), null);
    const found = await store.get(9);
    assert.equal(found?.id, 9);
    assert.equal(found?.archived_at, "2026-01-01T00:00:00Z");
    assert.equal(calls[7].url, "https://t:1/v1/tasks/number/8");
});

test("api backend resolves a task uuid once and role suggestions page by offset", async () => {
    const { calls, fetch } = recordingFetch([
        { body: apiTask(3) }, {}, {},
        { body: { items: [{ task_number: 3, role_id: "r", confidence: "high", match_reason: "m", review_status: "suggested", source_registry: "s", updated_at: null }] } },
    ]);
    const store = new ApiTaskStore("http://x", "t", { fetch });
    await store.complete(3);
    await store.archive(3, "r");
    assert.equal(calls.filter((call) => call.url.endsWith("/v1/tasks/number/3")).length, 1);
    const suggestions = await store.roleSuggestions({ review_status: "suggested" });
    assert.deepEqual(suggestions.map((s) => [s.task, s.role_id]), [[3, "r"]]);
    assert.equal(new URL(calls[3].url).pathname, "/v1/task-role-suggestions");
    assert.equal(new URL(calls[3].url).searchParams.get("review_status"), "suggested");
    const failing: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({ detail: { reason: "forbidden" } }) });
    await assert.rejects(new ApiTaskStore("http://x", "t", { fetch: failing }).archive(3, "r"), /403: forbidden/);
});

test("sqlite roleSuggestions matches the old query order", async () => {
    const db = fixture();
    db.exec(`CREATE TABLE task_role_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, role_id TEXT NOT NULL,
        confidence TEXT, match_reason TEXT, review_status TEXT DEFAULT 'suggested', source_registry TEXT, updated_at TEXT)`);
    const insert = db.prepare("INSERT INTO task_role_suggestions (task_id, role_id, confidence, match_reason, review_status, source_registry) VALUES (?, ?, 'high', 'm', ?, 's')");
    insert.run(2, "b", "suggested"); insert.run(1, "z", "suggested"); insert.run(1, "a", "accepted"); insert.run(1, "c", "suggested");
    const store = new SqliteTaskStore(db);
    assert.deepEqual((await store.roleSuggestions({ review_status: "suggested" })).map((s) => [s.task, s.role_id]), [[1, "c"], [1, "z"], [2, "b"]]);
    assert.equal((await store.roleSuggestions()).length, 4);
});

// ─── Client config file ───────────────────────────────────────

function clientFile(content: string | null, mode = 0o600) {
    const dir = mkdtempSync(join(tmpdir(), "client-config-"));
    const path = join(dir, "client.env");
    if (content !== null) {
        writeFileSync(path, content);
        chmodSync(path, mode);
    }
    return { path, env: { EMPIRE_CLIENT_CONFIG: path } as NodeJS.ProcessEnv };
}

test("client config: a missing file and no env is an error, sqlite is retired", () => {
    assert.throws(() => clientSettings(clientFile(null).env), /no task backend configured/);
    assert.throws(() => clientSettings({ ...clientFile(null).env, SOLO_EMPIRE_TASKS_BACKEND: "sqlite" }), /the SQLite task backend was retired on 2026-10-09; tasks live in the Tasks API/);
    assert.throws(() => clientSettings(clientFile("SOLO_EMPIRE_TASKS_BACKEND=sqlite\n").env), /retired/);
});

test("client config: the file selects api and ignores other keys", () => {
    const { env } = clientFile('# note\n\nSOLO_EMPIRE_TASKS_BACKEND=api\nEMPIRE_TASKS_API="https://tasks.example.com"\nOTHER=x\n');
    const settings = clientSettings(env);
    assert.deepEqual([settings.backend, settings.apiUrl, settings.backendSource], ["api", "https://tasks.example.com", "file"]);
    const store = openTaskStore("dashboard-api", { env: { ...env, EMPIRE_AUTOMATION_TOKEN_DASHBOARD_API: "t" } });
    assert.ok(store instanceof ApiTaskStore);
});

test("client config: a non-empty env var beats the file, an empty one does not", () => {
    const { env } = clientFile("SOLO_EMPIRE_TASKS_BACKEND=api\nEMPIRE_TASKS_API=https://a.example.com\n");
    const winner = clientSettings({ ...env, SOLO_EMPIRE_TASKS_BACKEND: "api", EMPIRE_TASKS_API: "http://127.0.0.1:1" });
    assert.deepEqual([winner.backend, winner.apiUrl, winner.apiUrlSource], ["api", "http://127.0.0.1:1", "env"]);
    assert.throws(() => clientSettings({ ...env, SOLO_EMPIRE_TASKS_BACKEND: "sqlite" }), /retired/);
    assert.equal(clientSettings({ ...env, SOLO_EMPIRE_TASKS_BACKEND: "" }).backend, "api");
});

test("client config: group/world accessible files are refused", () => {
    for (const mode of [0o640, 0o604, 0o620, 0o666]) {
        const { env } = clientFile("SOLO_EMPIRE_TASKS_BACKEND=api\nEMPIRE_TASKS_API=https://a.example.com\n", mode);
        assert.throws(() => clientSettings(env), /refusing client config/);
        assert.throws(() => openTaskStore("dashboard-api", { env }), /refusing client config/);
    }
});

test("client config: api without a usable URL is refused", () => {
    assert.throws(() => clientSettings(clientFile("SOLO_EMPIRE_TASKS_BACKEND=api\n").env), /sets no EMPIRE_TASKS_API/);
    assert.throws(
        () => clientSettings(clientFile("SOLO_EMPIRE_TASKS_BACKEND=api\nEMPIRE_TASKS_API=ftp://x\n").env),
        /https URL/,
    );
});

test("client config: non-https API URLs are refused unless the host is loopback", () => {
    for (const url of ["http://tasks.example.com", "http://10.0.0.5:3601", "http://127.0.0.1@evil.example.com",
        "http://localhost.evil.example.com", "https://", "ws://127.0.0.1"]) {
        assert.throws(() => clientSettings(clientFile(`SOLO_EMPIRE_TASKS_BACKEND=api\nEMPIRE_TASKS_API=${url}\n`).env), /EMPIRE_TASKS_API/, url);
        assert.throws(() => clientSettings({ ...clientFile(null).env, SOLO_EMPIRE_TASKS_BACKEND: "api", EMPIRE_TASKS_API: url }), /EMPIRE_TASKS_API/, url);
    }
    for (const url of ["http://127.0.0.1:3601", "http://[::1]:3601", "http://localhost:3601", "https://tasks.example.com"]) {
        assert.equal(clientSettings({ ...clientFile(null).env, SOLO_EMPIRE_TASKS_BACKEND: "api", EMPIRE_TASKS_API: url }).apiUrl, url);
    }
});

test("api store refuses redirects so the Bearer token is never forwarded", async () => {
    const seen: any[] = [];
    const fetcher: FetchLike = async (_url, init) => {
        seen.push(init);
        return { ok: true, status: 200, json: async () => ({}) };
    };
    await new ApiTaskStore("http://127.0.0.1:1", "t", { fetch: fetcher }).archive(3, "r").catch(() => undefined);
    assert.equal(seen[0].redirect, "error");
});

test("token lookup: repo dir first, then ~/.config/empire-platform/tokens; loose modes refused", () => {
    const root = mkdtempSync(join(tmpdir(), "tok-root-"));
    const home = mkdtempSync(join(tmpdir(), "tok-home-"));
    const homeDir = join(home, ".config", "empire-platform", "tokens");
    const repoDir = join(root, ".runtime", "automation-tokens");
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    assert.throws(() => automationToken("probe", {}, root, home), /no token/);
    writeFileSync(join(homeDir, "probe.jwt"), "home-token\n", { mode: 0o600 });
    assert.equal(automationToken("probe", {}, root, home), "home-token");
    writeFileSync(join(repoDir, "probe.jwt"), "repo-token", { mode: 0o600 });
    assert.equal(automationToken("probe", {}, root, home), "repo-token");
    rmSync(join(repoDir, "probe.jwt"));
    for (const mode of [0o640, 0o604, 0o644]) {
        chmodSync(join(homeDir, "probe.jwt"), mode);
        assert.throws(() => automationToken("probe", {}, root, home), (e: Error) => /refusing token file/.test(e.message) && !e.message.includes("home-token"));
    }
    assert.equal(automationToken("probe", { EMPIRE_AUTOMATION_TOKEN_PROBE: "env-token" }, root, home), "env-token");
});
