/**
 * Habits cell client for the TypeScript runtimes (owner CLI, dashboard). Mirrors the read and
 * log surface of solo-ops infra/scripts/utils/habits_store.py. Habits live in the habits cell (solo-habits);
 * the service owns current_streak, best_streak and last_completed_at, so callers never compute streaks.
 *
 *   EMPIRE_HABITS_API=https://...   # env, or the owner-only client file (see task-store clientValue)
 */
import { automationToken, clientValue, validateApiUrl, type FetchLike } from "./task-store.js";

export type { FetchLike };

export interface Habit {
    id: number;
    slug?: string;
    name: string;
    category: string | null;
    status: string;
    priority: number;
    frequency?: string | null;
    current_streak: number;
    best_streak: number;
    last_completed_at: string | null;
    target_duration_minutes?: number | null;
    preferred_time?: string | null;
    [key: string]: any;
}

export interface HabitLog {
    id?: number;
    habit_id: number;
    log_date: string;
    completed: boolean;
    count?: number | null;
    duration_minutes?: number | null;
    notes?: string | null;
    [key: string]: any;
}

export interface HabitFilters { status?: string | string[]; category?: string; frequency?: string }
export interface HabitLogFilters {
    habit_id?: number; from?: string; to?: string; completed?: boolean; order?: "asc" | "desc";
}
export interface HabitLogFields { completed?: boolean; count?: number; duration_minutes?: number; notes?: string }

export class HabitsStoreError extends Error {
    constructor(readonly status: number, readonly reason: string) {
        super(`habits API ${status}: ${reason}`);
        this.name = "HabitsStoreError";
    }
}

const PAGE = 500;

export class ApiHabitsStore {
    private readonly baseUrl: string;

    constructor(
        baseUrl: string,
        private readonly token: string,
        private readonly opts: { channel?: string; fetch?: FetchLike; correlationId?: string } = {},
    ) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    private async request(method: string, path: string, params: Array<[string, string]> = [], body?: unknown): Promise<any> {
        const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
        const doFetch: FetchLike = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            "X-Empire-Channel": this.opts.channel ?? "cli",
            "X-Correlation-Id": this.opts.correlationId ?? "habits-store",
            "Content-Type": "application/json",
        };
        const response = await doFetch(`${this.baseUrl}${path}${query}`, {
            method, headers, redirect: "error", // never forward the Bearer token to a redirect target
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) {
            let reason = "error";
            try {
                const detail = (await response.json())?.detail;
                if (detail && typeof detail === "object") reason = detail.reason || detail.error || reason;
            } catch { /* keep generic reason */ }
            throw new HabitsStoreError(response.status, reason);
        }
        return response.json();
    }

    private async pages(path: string, params: Array<[string, string]>): Promise<any[]> {
        const items: any[] = [];
        for (;;) {
            const page: any[] = (await this.request("GET", path, [...params, ["limit", String(PAGE)], ["offset", String(items.length)]])).items;
            items.push(...page);
            if (page.length < PAGE) return items;
        }
    }

    async habits(filters: HabitFilters = {}): Promise<Habit[]> {
        const params: Array<[string, string]> = [];
        const statuses = typeof filters.status === "string" ? [filters.status] : filters.status ?? [];
        for (const status of statuses) params.push(["status", status]);
        if (filters.category) params.push(["category", filters.category]);
        if (filters.frequency) params.push(["frequency", filters.frequency]);
        return this.pages("/v1/habits", params);
    }

    /** One habit by id; null when it does not exist. */
    async habit(id: number): Promise<Habit | null> {
        try {
            return await this.request("GET", `/v1/habits/${Math.trunc(id)}`);
        } catch (error) {
            if (error instanceof HabitsStoreError && error.status === 404) return null;
            throw error;
        }
    }

    /** Upserts one day's log (completed defaults to true on the service). */
    async logHabit(id: number, date: string, fields: HabitLogFields = {}): Promise<{ outcome: string; log: HabitLog }> {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("log date must be YYYY-MM-DD");
        return this.request("PUT", `/v1/habits/${Math.trunc(id)}/logs/${date}`, [], fields);
    }

    async habitLogs(filters: HabitLogFilters = {}): Promise<HabitLog[]> {
        const params: Array<[string, string]> = [];
        if (filters.habit_id !== undefined) params.push(["habit_id", String(filters.habit_id)]);
        if (filters.from) params.push(["from", filters.from]);
        if (filters.to) params.push(["to", filters.to]);
        if (filters.completed !== undefined) params.push(["completed", filters.completed ? "true" : "false"]);
        params.push(["order", filters.order ?? "asc"]);
        return this.pages("/v1/habit-logs", params);
    }

    /** Habit counts per status, e.g. { active: 5 }. */
    async stats(groupBy = "status"): Promise<Record<string, number>> {
        return (await this.request("GET", "/v1/habits/stats", [["group_by", groupBy]])).groups;
    }
}

export function habitsApiUrl(env: NodeJS.ProcessEnv = process.env): string {
    const value = clientValue("EMPIRE_HABITS_API", env);
    if (!value) throw new Error("the habits API is not configured: set EMPIRE_HABITS_API (env or client.env)");
    return validateApiUrl(value, "EMPIRE_HABITS_API");
}

export function openHabitsStore(
    automation: string,
    opts: { channel?: string; env?: NodeJS.ProcessEnv; fetch?: FetchLike } = {},
): ApiHabitsStore {
    const env = opts.env ?? process.env;
    return new ApiHabitsStore(habitsApiUrl(env), automationToken(automation, env), { channel: opts.channel, fetch: opts.fetch });
}
