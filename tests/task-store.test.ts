import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
    ApiTaskStore,
    legacyTaskRow,
    legacyTaskTypeRow,
    openTaskStore,
    sqlLike,
    type FetchLike,
} from "../src/task-store.js";
import { registerCustomizationTools } from "../src/tools/customization.js";
import { registerPerformanceTools } from "../src/tools/performance.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const schema = readFileSync(join(root, "infra", "database", "schema.sql"), "utf8");

function fixture() {
    const db = new Database(":memory:");
    db.exec(schema.slice(schema.indexOf("CREATE TABLE tasks (")).split(";", 1)[0]);
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
    const store = openTaskStore(db, "dashboard-api", { env: {} });
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
    const store = openTaskStore(db, "dashboard-api", { env: {} });
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
    const store = openTaskStore(db, "dashboard-api", { env: {} });
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
    const store = openTaskStore(null, "dashboard-api", {
        channel: "dashboard", fetch,
        env: { SOLO_EMPIRE_TASKS_BACKEND: "api", EMPIRE_TASKS_API: "http://tasks.test:3601/", EMPIRE_AUTOMATION_TOKEN_DASHBOARD_API: "tok" },
    });
    const tasks = await store.list({ project: "p 1", status: ["todo", "done"], include_archived: true, priority_max: 2 });
    assert.equal(tasks.length, 201);
    assert.equal(tasks[200].id, 201);
    assert.equal(tasks[200].parent_task_id, 7);
    assert.deepEqual(tasks[0].tags, ["a"]);
    assert.equal(calls.length, 2);
    const url = new URL(calls[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "http://tasks.test:3601/v1/tasks");
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
        () => openTaskStore(null, "no-such-automation", { env: { SOLO_EMPIRE_TASKS_BACKEND: "api" } }),
        /no token for automation/,
    );
    assert.throws(() => openTaskStore(null, "x", { env: { SOLO_EMPIRE_TASKS_BACKEND: "nope" } }), /unknown SOLO_EMPIRE_TASKS_BACKEND/);
    assert.throws(() => openTaskStore(null, "x", { env: {} }), /needs a connection/);
});

async function mcp(db: Database.Database) {
    const server = new McpServer({ name: "fixture", version: "1.0.0" });
    const client = new Client({ name: "fixture-client", version: "1.0.0" });
    const context: any = { server, getDb: () => db };
    registerCustomizationTools(context);
    registerPerformanceTools(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as any[]).find((item) => item.type === "text");
        return JSON.parse(text.text);
    };
}

test("MCP run_custom_view, list_task_types and db_stats keep their old output", async () => {
    const db = fixture();
    const view = db.prepare("INSERT INTO custom_views (name, filter_criteria, sort_criteria) VALUES (?, ?, ?)");
    view.run("v1", JSON.stringify({ status: ["todo", "blocked", "in_progress"], tags: "a" }), null);
    view.run("v2", JSON.stringify({ priority: 2, project: "p1" }), JSON.stringify({ field: "created_at", direction: "DESC" }));
    view.run("v3", JSON.stringify({}), JSON.stringify({ field: "due_date" }));
    view.run("v4", JSON.stringify({}), JSON.stringify({ field: "nope" }));
    const call = await mcp(db);

    const oldView = (sql: string, ...params: any[]) => db.prepare(sql).all(...params);
    assert.deepEqual((await call("run_custom_view", { view_id: 1 })).tasks, oldView(
        "SELECT * FROM tasks WHERE archived_at IS NULL AND status IN (?,?,?) AND tags LIKE ? ORDER BY priority, due_date",
        "todo", "blocked", "in_progress", "%a%"));
    assert.deepEqual((await call("run_custom_view", { view_id: 2 })).tasks, oldView(
        "SELECT * FROM tasks WHERE archived_at IS NULL AND priority IN (?) AND project = ? ORDER BY created_at DESC", 2, "p1"));
    assert.deepEqual((await call("run_custom_view", { view_id: 3 })).tasks, oldView(
        "SELECT * FROM tasks WHERE archived_at IS NULL ORDER BY due_date ASC"));
    assert.equal((await call("run_custom_view", { view_id: 1 })).task_count, 2);

    assert.deepEqual((await call("list_task_types")).task_types,
        db.prepare("SELECT * FROM task_types WHERE is_active = 1 ORDER BY sort_order, name").all());

    const stats = await call("db_stats");
    assert.equal(stats.total_tasks, 5);
    assert.deepEqual(stats.by_status, db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all());
    assert.deepEqual(stats.by_priority, db.prepare("SELECT priority, COUNT(*) as count FROM tasks GROUP BY priority ORDER BY priority").all());
    assert.deepEqual(stats.top_projects, db.prepare(
        "SELECT project, COUNT(*) as count FROM tasks WHERE project IS NOT NULL GROUP BY project ORDER BY count DESC, project LIMIT 10").all());
});
