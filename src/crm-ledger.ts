/**
 * Client of the CRM ledger (revenue, invoices, clients) on the owner's
 * income-pipeline CRM. Mirrors ops-toolkit infra/scripts/utils/crm_ledger.py.
 *
 * Revenue, invoices and clients left the control plane on 2026-10-11 for the
 * CRM (bookchaowalit/crm). The URL comes from EMPIRE_CRM_LEDGER_API
 * (environment or the owner-only client file); the bearer token is the CRM
 * owner token, from EMPIRE_CRM_LEDGER_TOKEN or the owner-only file
 * ~/.config/solo-crm/income.token. https only (http on loopback); redirects are
 * never followed; the token is never printed.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { clientValue, validateApiUrl, type FetchLike } from "./task-store.js";

export const LEDGER_URL_KEY = "EMPIRE_CRM_LEDGER_API";
export const LEDGER_TOKEN_KEY = "EMPIRE_CRM_LEDGER_TOKEN";

export class LedgerError extends Error {
    constructor(readonly status: number, readonly reason: string) {
        super(`CRM ledger ${status}: ${reason}`);
        this.name = "LedgerError";
    }
}

export type LedgerRow = Record<string, any>;
export type LedgerTotals = Record<string, number>;

export interface RevenueFilters {
    since?: string;
    until?: string;
    source_type?: string;
    client_id?: number;
    received?: boolean;
    limit?: number;
}

export class CrmLedger {
    private readonly baseUrl: string;

    constructor(baseUrl: string, private readonly token: string, private readonly opts: { fetch?: FetchLike } = {}) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    private async call(method: string, path: string, params: Record<string, string | number | boolean | undefined> = {}, body?: unknown): Promise<any> {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(key, String(value));
        const doFetch: FetchLike = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
        const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        let response;
        try {
            response = await doFetch(`${this.baseUrl}/api/v1/crm/ledger${path}${query.size ? `?${query}` : ""}`, {
                method, headers, redirect: "error", // never forward the Bearer token to a redirect target
                signal: AbortSignal.timeout(30_000), // same deadline as crm_ledger.py; a hung CRM reads as unavailable
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
        } catch (error) {
            throw new LedgerError(503, `unavailable:${(error as Error)?.name ?? "Error"}`);
        }
        if (!response.ok) {
            let reason = "error";
            try {
                const detail = (await response.json())?.error;
                reason = String(detail?.code || detail?.message || reason);
            } catch { /* keep generic reason */ }
            throw new LedgerError(response.status, reason);
        }
        try { return await response.json(); } catch (error) {
            throw new LedgerError(503, `unavailable:${(error as Error)?.name ?? "Error"}`); // not JSON: proxy page or cut body
        }
    }

    /** Rows newest first and totals per currency for the filters. */
    async revenue(filters: RevenueFilters = {}): Promise<{ rows: LedgerRow[]; totals: LedgerTotals }> {
        const out = await this.call("GET", "/revenue", {
            since: filters.since, until: filters.until, source_type: filters.source_type, client_id: filters.client_id,
            limit: Math.min(filters.limit ?? 500, 500), received: filters.received === undefined ? undefined : Boolean(filters.received),
        });
        return { rows: out.items, totals: out.totals };
    }

    /** Every matching row (all pages, newest first) and the totals per currency. */
    async revenueAll(filters: Omit<RevenueFilters, "limit"> = {}): Promise<{ rows: LedgerRow[]; totals: LedgerTotals }> {
        const rows: LedgerRow[] = [];
        for (;;) {
            const out = await this.call("GET", "/revenue", {
                since: filters.since, until: filters.until, source_type: filters.source_type, client_id: filters.client_id,
                received: filters.received === undefined ? undefined : Boolean(filters.received), limit: 500, offset: rows.length,
            });
            rows.push(...out.items);
            if (out.items.length < 500) return { rows, totals: out.totals };
        }
    }

    async addRevenue(fields: Record<string, unknown>): Promise<{ outcome: string; revenue: LedgerRow }> {
        return this.call("POST", "/revenue", {}, fields);
    }

    async invoices(filters: { status?: string; client_id?: number; limit?: number } = {}): Promise<LedgerRow[]> {
        return (await this.call("GET", "/invoices", { status: filters.status, client_id: filters.client_id, limit: Math.min(filters.limit ?? 500, 500) })).items;
    }

    async clients(filters: { status?: string; q?: string; limit?: number } = {}): Promise<LedgerRow[]> {
        return (await this.call("GET", "/clients", { status: filters.status, q: filters.q, limit: Math.min(filters.limit ?? 500, 500) })).items;
    }
}

export function ledgerUrl(env: NodeJS.ProcessEnv = process.env): string {
    const value = clientValue(LEDGER_URL_KEY, env);
    if (!value) throw new Error(`the CRM ledger is not configured: set ${LEDGER_URL_KEY} (env or client.env)`);
    return validateApiUrl(value, LEDGER_URL_KEY);
}

export function ledgerToken(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
    if ((env[LEDGER_TOKEN_KEY] || "").trim()) return (env[LEDGER_TOKEN_KEY] as string).trim();
    const path = resolve(home, ".config", "solo-crm", "income.token");
    let mode: number;
    try {
        mode = statSync(path).mode;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`no CRM ledger token: set ${LEDGER_TOKEN_KEY} or create ${path}`);
        throw error;
    }
    if (mode & 0o077) throw new Error(`${path} must be readable by its owner only (chmod 600)`);
    return readFileSync(path, "utf8").trim();
}

export function openCrmLedger(env: NodeJS.ProcessEnv = process.env, opts: { fetch?: FetchLike; home?: string } = {}): CrmLedger {
    return new CrmLedger(ledgerUrl(env), ledgerToken(env, opts.home), { fetch: opts.fetch });
}

/** Run a ledger read; an unconfigured or unreachable ledger yields {available:false} instead of throwing. */
export async function ledgerSection<T>(read: (ledger: CrmLedger) => Promise<T>, env: NodeJS.ProcessEnv = process.env):
    Promise<{ available: true; data: T } | { available: false; reason: string }> {
    try {
        return { available: true, data: await read(openCrmLedger(env)) };
    } catch (error) {
        const message = error instanceof LedgerError ? `${error.status}:${error.reason}` : (error as Error).message.split("\n")[0];
        return { available: false, reason: message };
    }
}

export function totalThb(totals: LedgerTotals): number {
    return Number(totals.THB ?? 0);
}
