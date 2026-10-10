/**
 * One client for every cell made with solo-cell-kit (goals, projects, roles-skills, ...), for the
 * TypeScript runtimes (owner CLI, dashboard, MCP). Mirrors infra/scripts/utils/cell_store.py: every
 * resource has list (all pages), get, create, update, delete and stats.
 *
 *   EMPIRE_GOALS_API=https://...   # EMPIRE_<CELL>_API, env or the owner-only client file
 *
 *   const goals = openCellStore("goals", "dashboard-api");
 *   const active = await goals.list("goals", { status: ["active", "planning"] });
 */
import { automationToken, clientValue, validateApiUrl, type FetchLike } from "./task-store.js";

export type { FetchLike };

export type CellRecord = { id: number; legacy_id: number | null; version: number; [key: string]: any };
export type Filters = Record<string, string | number | boolean | Array<string | number | boolean> | null | undefined>;

export class CellStoreError extends Error {
    constructor(readonly status: number, readonly reason: string, readonly cell = "cell") {
        super(`${cell} API ${status}: ${reason}`);
        this.name = "CellStoreError";
    }
}

const PAGE = 1000;

/** What the runtimes use; ApiCellStore is the production implementation, tests substitute a SQLite double. */
export interface CellStore {
    readonly cell: string;
    list(plural: string, filters?: Filters, order?: "asc" | "desc"): Promise<CellRecord[]>;
    get(plural: string, id: number): Promise<CellRecord | null>;
    create(plural: string, fields: Record<string, unknown>, idempotencyKey?: string): Promise<CellRecord>;
    update(plural: string, id: number, fields: Record<string, unknown>, expectedVersion?: number): Promise<CellRecord>;
    delete(plural: string, id: number): Promise<boolean>;
    stats(plural: string, groupBy: string, filters?: Filters): Promise<Record<string, number>>;
}

export class ApiCellStore implements CellStore {
    private readonly baseUrl: string;

    constructor(
        readonly cell: string,
        baseUrl: string,
        private readonly token: string,
        private readonly opts: { channel?: string; fetch?: FetchLike; correlationId?: string } = {},
    ) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    private async request(method: string, path: string, params: Array<[string, string]> = [], body?: unknown,
                          extra: Record<string, string> = {}): Promise<any> {
        const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
        const doFetch: FetchLike = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
        const response = await doFetch(`${this.baseUrl}${path}${query}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.token}`,
                "X-Empire-Channel": this.opts.channel ?? "cli",
                "X-Correlation-Id": this.opts.correlationId ?? `${this.cell}-store`,
                "Content-Type": "application/json",
                ...extra,
            },
            redirect: "error", // never forward the Bearer token to a redirect target
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) {
            let reason = "error";
            try {
                const detail = (await response.json())?.detail;
                if (detail && typeof detail === "object") reason = detail.reason || detail.error || reason;
            } catch { /* keep generic reason */ }
            throw new CellStoreError(response.status, reason, this.cell);
        }
        return response.status === 204 ? null : response.json();
    }

    private static params(filters: Filters): Array<[string, string]> {
        const out: Array<[string, string]> = [];
        for (const [name, value] of Object.entries(filters)) {
            if (value === undefined || value === null) continue;
            for (const item of Array.isArray(value) ? value : [value]) out.push([name, String(item)]);
        }
        return out;
    }

    /** Every matching record (all pages); `null: ["field"]` matches empty fields. */
    async list(plural: string, filters: Filters = {}, order: "asc" | "desc" = "asc"): Promise<CellRecord[]> {
        const params = [...ApiCellStore.params(filters), ["order", order] as [string, string]];
        const items: CellRecord[] = [];
        for (;;) {
            const page: CellRecord[] = (await this.request("GET", `/v1/${plural}`,
                [...params, ["limit", String(PAGE)], ["offset", String(items.length)]])).items;
            items.push(...page);
            if (page.length < PAGE) return items;
        }
    }

    async get(plural: string, id: number): Promise<CellRecord | null> {
        try {
            return await this.request("GET", `/v1/${plural}/${Math.trunc(id)}`);
        } catch (error) {
            if (error instanceof CellStoreError && error.status === 404) return null;
            throw error;
        }
    }

    async create(plural: string, fields: Record<string, unknown>, idempotencyKey?: string): Promise<CellRecord> {
        return this.request("POST", `/v1/${plural}`, [], fields, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    }

    async update(plural: string, id: number, fields: Record<string, unknown>, expectedVersion?: number): Promise<CellRecord> {
        return this.request("PATCH", `/v1/${plural}/${Math.trunc(id)}`, [], {
            ...fields, ...(expectedVersion ? { expected_version: expectedVersion } : {}),
        });
    }

    async delete(plural: string, id: number): Promise<boolean> {
        try {
            await this.request("DELETE", `/v1/${plural}/${Math.trunc(id)}`);
            return true;
        } catch (error) {
            if (error instanceof CellStoreError && error.status === 404) return false;
            throw error;
        }
    }

    async stats(plural: string, groupBy: string, filters: Filters = {}): Promise<Record<string, number>> {
        return (await this.request("GET", `/v1/${plural}/stats`, [...ApiCellStore.params(filters), ["group_by", groupBy]])).groups;
    }
}

export function cellApiKey(cell: string): string {
    return `EMPIRE_${cell.toUpperCase().replace(/-/g, "_")}_API`;
}

export function cellApiUrl(cell: string, env: NodeJS.ProcessEnv = process.env): string {
    const key = cellApiKey(cell);
    const value = clientValue(key, env);
    if (!value) throw new Error(`the ${cell} API is not configured: set ${key} (env or client.env)`);
    return validateApiUrl(value, key);
}

/** Test seam: replaces the store openCellStore returns (in-process only; no env or file selects it). */
let storeOverride: ((cell: string, automation: string) => CellStore) | null = null;
export function overrideCellStoreForTests(factory: ((cell: string, automation: string) => CellStore) | null): void {
    storeOverride = factory;
}

export function openCellStore(
    cell: string,
    automation: string,
    opts: { channel?: string; env?: NodeJS.ProcessEnv; fetch?: FetchLike } = {},
): CellStore {
    if (storeOverride) return storeOverride(cell, automation);
    const env = opts.env ?? process.env;
    return new ApiCellStore(cell, cellApiUrl(cell, env), automationToken(automation, env),
                            { channel: opts.channel, fetch: opts.fetch });
}
