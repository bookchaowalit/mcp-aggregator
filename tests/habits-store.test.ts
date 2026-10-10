import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiHabitsStore, HabitsStoreError, habitsApiUrl, openHabitsStore, type FetchLike } from "../src/habits-store.js";

function fake(respond: (url: URL, init: any) => { status?: number; body: any }) {
    const calls: Array<{ url: URL; init: any }> = [];
    const fetch: FetchLike = async (url, init) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, init });
        const { status = 200, body } = respond(parsed, init);
        return { ok: status < 400, status, json: async () => body };
    };
    return { calls, fetch };
}

test("habits sends filters, auth headers and no-redirect", async () => {
    const { calls, fetch } = fake(() => ({ body: { items: [{ id: 1, name: "Read" }] } }));
    const store = new ApiHabitsStore("https://h.example/", "tok", { channel: "cli", fetch });
    const items = await store.habits({ status: "active", category: "health" });
    assert.equal(items.length, 1);
    const { url, init } = calls[0];
    assert.equal(url.pathname, "/v1/habits");
    assert.equal(url.searchParams.get("status"), "active");
    assert.equal(url.searchParams.get("category"), "health");
    assert.equal(url.searchParams.get("offset"), "0");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer tok");
    assert.equal(init.headers["X-Empire-Channel"], "cli");
});

test("habits pages until a short page", async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const { calls, fetch } = fake((url) => ({ body: { items: url.searchParams.get("offset") === "0" ? full : [{ id: 500 }] } }));
    const items = await new ApiHabitsStore("https://h.example", "t", { fetch }).habits();
    assert.equal(items.length, 501);
    assert.equal(calls.length, 2);
});

test("habit returns null on 404 and throws other errors", async () => {
    const missing = fake(() => ({ status: 404, body: { detail: { reason: "not_found" } } }));
    assert.equal(await new ApiHabitsStore("https://h.example", "t", { fetch: missing.fetch }).habit(9), null);
    const broken = fake(() => ({ status: 500, body: { detail: { reason: "boom" } } }));
    await assert.rejects(new ApiHabitsStore("https://h.example", "t", { fetch: broken.fetch }).habit(9),
        (error: unknown) => error instanceof HabitsStoreError && error.status === 500 && error.reason === "boom");
});

test("logHabit PUTs the day log and never sends streaks", async () => {
    const { calls, fetch } = fake(() => ({ body: { outcome: "created", log: { habit_id: 3, log_date: "2026-10-10", completed: true } } }));
    const store = new ApiHabitsStore("https://h.example", "t", { fetch });
    const result = await store.logHabit(3, "2026-10-10", { duration_minutes: 30 });
    assert.equal(result.outcome, "created");
    assert.equal(calls[0].init.method, "PUT");
    assert.equal(calls[0].url.pathname, "/v1/habits/3/logs/2026-10-10");
    assert.deepEqual(JSON.parse(calls[0].init.body), { duration_minutes: 30 });
    await assert.rejects(store.logHabit(3, "10-10-2026"), /YYYY-MM-DD/);
});

test("habitLogs and stats", async () => {
    const { calls, fetch } = fake((url) => ({ body: url.pathname.endsWith("/stats") ? { groups: { active: 4 } } : { items: [] } }));
    const store = new ApiHabitsStore("https://h.example", "t", { fetch });
    await store.habitLogs({ from: "2026-10-01", to: "2026-10-10", completed: true, order: "desc" });
    assert.equal(calls[0].url.searchParams.get("completed"), "true");
    assert.equal(calls[0].url.searchParams.get("from"), "2026-10-01");
    assert.equal(calls[0].url.searchParams.get("order"), "desc");
    assert.deepEqual(await store.stats(), { active: 4 });
    assert.equal(calls[1].url.searchParams.get("group_by"), "status");
});

test("openHabitsStore reads EMPIRE_HABITS_API from env or the client file and validates it", () => {
    const dir = mkdtempSync(join(tmpdir(), "habits-store-"));
    try {
        const file = join(dir, "client.env");
        writeFileSync(file, "EMPIRE_HABITS_API=https://file.example\n");
        chmodSync(file, 0o600);
        const base = { EMPIRE_CLIENT_CONFIG: file, EMPIRE_AUTOMATION_TOKEN_OWNER_CLI: "t" };
        assert.equal(habitsApiUrl(base), "https://file.example");
        assert.equal(habitsApiUrl({ ...base, EMPIRE_HABITS_API: "http://127.0.0.1:9" }), "http://127.0.0.1:9");
        assert.throws(() => habitsApiUrl({ ...base, EMPIRE_HABITS_API: "http://evil.example" }), /EMPIRE_HABITS_API must be an https URL/);
        assert.ok(openHabitsStore("owner-cli", { env: base }) instanceof ApiHabitsStore);
        assert.throws(() => habitsApiUrl({ EMPIRE_CLIENT_CONFIG: join(dir, "missing.env") }), /not configured/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
