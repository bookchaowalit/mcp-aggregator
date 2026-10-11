import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CrmLedger, LedgerError, ledgerSection, ledgerToken, ledgerUrl, openCrmLedger } from "../src/crm-ledger.js";
import type { FetchLike } from "../src/task-store.js";

function fakeFetch(status: number, body: unknown, seen: Array<{ url: string; init: any }> = []): FetchLike {
    return async (url, init) => {
        seen.push({ url, init });
        return { ok: status >= 200 && status < 300, status, json: async () => body };
    };
}

test("revenue sends the bearer token, filters and never follows redirects", async () => {
    const seen: Array<{ url: string; init: any }> = [];
    const ledger = new CrmLedger("https://crm.example/", "tok", {
        fetch: fakeFetch(200, { items: [{ id: 1 }], totals: { THB: 1500 } }, seen),
    });
    const { rows, totals } = await ledger.revenue({ since: "2026-10-01", received: true });
    assert.deepEqual(rows, [{ id: 1 }]);
    assert.deepEqual(totals, { THB: 1500 });
    assert.equal(seen[0].init.redirect, "error");
    assert.equal(seen[0].init.headers.Authorization, "Bearer tok");
    const url = new URL(seen[0].url);
    assert.equal(url.pathname, "/api/v1/crm/ledger/revenue");
    assert.equal(url.searchParams.get("since"), "2026-10-01");
    assert.equal(url.searchParams.get("received"), "true");
});

test("an HTTP error becomes a LedgerError and a network error becomes 503", async () => {
    const denied = new CrmLedger("https://crm.example", "tok", { fetch: fakeFetch(401, { error: { code: "unauthorized" } }) });
    await assert.rejects(denied.clients(), (e: unknown) => e instanceof LedgerError && e.status === 401 && e.reason === "unauthorized");
    const down = new CrmLedger("https://crm.example", "tok", { fetch: async () => { throw new TypeError("fetch failed"); } });
    await assert.rejects(down.invoices(), (e: unknown) => e instanceof LedgerError && e.status === 503);
});

test("configuration: https only, token from env or an owner-only file", () => {
    const home = mkdtempSync(join(tmpdir(), "ledger-"));
    const env = { EMPIRE_CLIENT_CONFIG: join(home, "none.env"), EMPIRE_CRM_LEDGER_API: "https://crm.example" } as NodeJS.ProcessEnv;
    assert.equal(ledgerUrl(env), "https://crm.example");
    assert.throws(() => ledgerUrl({ ...env, EMPIRE_CRM_LEDGER_API: "http://crm.example" }), /https/);
    assert.throws(() => ledgerUrl({ EMPIRE_CLIENT_CONFIG: join(home, "none.env") } as NodeJS.ProcessEnv), /not configured/);
    assert.equal(ledgerToken({ EMPIRE_CRM_LEDGER_TOKEN: " abc " } as NodeJS.ProcessEnv, home), "abc");
    assert.throws(() => ledgerToken({} as NodeJS.ProcessEnv, home), /no CRM ledger token/);
    mkdirSync(join(home, ".config", "solo-crm"), { recursive: true });
    const file = join(home, ".config", "solo-crm", "income.token");
    writeFileSync(file, "filetok\n");
    chmodSync(file, 0o644);
    assert.throws(() => ledgerToken({} as NodeJS.ProcessEnv, home), /owner only/);
    chmodSync(file, 0o600);
    assert.equal(ledgerToken({} as NodeJS.ProcessEnv, home), "filetok");
    assert.ok(openCrmLedger({ ...env, EMPIRE_CRM_LEDGER_TOKEN: "t" } as NodeJS.ProcessEnv) instanceof CrmLedger);
});

test("ledgerSection reports unavailable instead of throwing", async () => {
    const out = await ledgerSection(async () => 1, { EMPIRE_CLIENT_CONFIG: "/nonexistent" } as NodeJS.ProcessEnv);
    assert.equal(out.available, false);
});
