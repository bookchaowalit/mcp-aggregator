/**
 * Read-side TaskStore adapter for the TypeScript runtimes (dashboard server and
 * MCP server). Mirrors the read surface of infra/scripts/utils/task_store.py:
 *
 *   SOLO_EMPIRE_TASKS_BACKEND=sqlite   # default: the control-plane SQLite DB
 *   SOLO_EMPIRE_TASKS_BACKEND=api      # empire-platform Tasks API
 *   EMPIRE_TASKS_API=http://127.0.0.1:3601
 *   EMPIRE_AUTOMATION_TOKEN_DASHBOARD_API=...  # or .runtime/automation-tokens/dashboard-api.jwt
 *
 * No other TypeScript file reads the task tables directly. Every method is
 * async because the API backend is. Lives under mcp-server/src so both
 * `infra/tsconfig.json` (dashboard) and `infra/mcp-server/tsconfig.json`
 * (rootDir: src) can import it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal better-sqlite3 surface so this module needs no native import. */
export interface SqliteLike {
    prepare(sql: string): { all(...params: any[]): any[]; get(...params: any[]): any };
}

export const AUTOMATION_ID = "dashboard-api";

/** Raw legacy row/table data a record was built from (SQLite backend only). */
export const RAW: unique symbol = Symbol("task-store.raw");

export interface TaskRecord {
    id: number; // task number
    title: string;
    description: string | null;
    status: string;
    priority: number;
    project: string | null;
    tags: string[];
    category: string | null;
    due_date: string | null;
    completed_at: string | null;
    notes: string | null;
    external_source: string | null;
    external_id: string | null;
    external_url: string | null;
    estimated_minutes: number | null;
    reminder_at: string | null;
    reminder_sent: boolean;
    reminder_channels: string | null;
    calendar_event_id: string | null;
    recurrence_rule: string | null;
    archived_at: string | null;
    is_recurring_instance: boolean;
    recurrence_occurrence: number | null;
    progress_percent: number;
    parent_task_id: number | null;
    parent_recurring_id: number | null;
    started_at: string | null;
    actual_minutes: number;
    archive_reason: string | null;
    created_at: string | null;
    updated_at: string | null;
    [RAW]?: Record<string, any>;
}

export interface TaskFilters {
    status?: string[];
    external_source?: string;
    no_external_source?: boolean;
    project?: string;
    category?: string;
    priority_max?: number;
    due_from?: string; // YYYY-MM-DD, >=
    due_before?: string; // YYYY-MM-DD, <
    completed_between?: [string, string]; // inclusive LOCAL dates
    created_between?: [string, string];
    reminder_due_before?: string;
    missing_calendar_event?: boolean;
    numbers?: number[];
    parent?: number;
    q?: string;
    include_archived?: boolean;
}

export type GroupBy = "status" | "priority" | "project" | "category";

export interface TaskStats {
    total: number;
    /** Sorted by key (null first); priority keys are strings. */
    groups: Array<{ key: string | null; count: number }>;
}

export interface TaskAssignment {
    task: number;
    assignee_type: "user" | "role" | "team";
    assignee_id: string;
    assignee_name: string | null;
    assignment_type: string;
}

export interface AssignmentFilters {
    task?: number;
    assignee_type?: "user" | "role" | "team";
    assignee_id?: string;
    assignment_type?: string;
}

export interface TaskTypeRecord {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    default_status: string;
    allowed_statuses: string[];
    is_active: boolean;
    sort_order: number;
    [RAW]?: Record<string, any>;
}

export interface TaskStore {
    list(filters?: TaskFilters): Promise<TaskRecord[]>;
    stats(groupBy?: GroupBy | null, filters?: TaskFilters): Promise<TaskStats>;
    assignments(filters?: AssignmentFilters): Promise<TaskAssignment[]>;
    taskTypes(opts?: { includeInactive?: boolean }): Promise<TaskTypeRecord[]>;
}

const FILTER_KEYS = new Set([
    "status", "external_source", "no_external_source", "project", "category", "priority_max", "due_from",
    "due_before", "completed_between", "created_between", "reminder_due_before", "missing_calendar_event",
    "numbers", "parent", "q", "include_archived",
]);
const GROUPS = new Set(["status", "priority", "project", "category"]);
const ASSIGNEE_TO_API = { user: "identity", role: "role", team: "team" } as const;
const ASSIGNEE_FROM_API: Record<string, TaskAssignment["assignee_type"]> = { identity: "user", role: "role", team: "team" };

function checkFilters(filters: TaskFilters): void {
    const unknown = Object.keys(filters).filter((key) => !FILTER_KEYS.has(key));
    if (unknown.length) throw new Error(`unknown task filters: ${unknown.sort().join(", ")}`);
}

export function tagsList(value: unknown): string[] {
    if (value === null || value === undefined || value === "") return [];
    if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
    const text = String(value).trim();
    if (text.startsWith("[")) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed.map((tag) => String(tag).trim()).filter(Boolean);
        } catch { /* fall through to comma-separated */ }
    }
    return text.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function dateOnly(value: unknown): string | null {
    return value === null || value === undefined || value === "" ? null : String(value).slice(0, 10);
}

/** Backend-neutral task from a row that already has `number`, `parent_number`, `parent_recurring_number`. */
function toRecord(row: Record<string, any>): TaskRecord {
    return {
        id: row.number, title: row.title, description: row.description ?? null,
        status: row.status, priority: row.priority, project: row.project ?? null,
        tags: tagsList(row.tags), category: row.category ?? null, due_date: dateOnly(row.due_date),
        completed_at: row.completed_at ?? null, notes: row.notes ?? null,
        external_source: row.external_source ?? null, external_id: row.external_id ?? null,
        external_url: row.external_url ?? null, estimated_minutes: row.estimated_minutes ?? null,
        reminder_at: row.reminder_at ?? null, reminder_sent: Boolean(row.reminder_sent),
        reminder_channels: row.reminder_channels ?? null, calendar_event_id: row.calendar_event_id ?? null,
        recurrence_rule: row.recurrence_rule ?? null, archived_at: row.archived_at ?? null,
        is_recurring_instance: Boolean(row.is_recurring_instance),
        recurrence_occurrence: row.recurrence_occurrence ?? null,
        progress_percent: row.progress_percent || 0, parent_task_id: row.parent_number ?? null,
        parent_recurring_id: row.parent_recurring_number ?? null, started_at: row.started_at ?? null,
        actual_minutes: row.actual_minutes || 0, archive_reason: row.archive_reason ?? null,
        created_at: row.created_at ?? null, updated_at: row.updated_at ?? null,
    };
}

/** Column order of the legacy `tasks` table, used when a record has no raw row. */
const LEGACY_TASK_COLUMNS = [
    "id", "title", "description", "status", "priority", "project", "tags", "category", "due_date", "completed_at",
    "external_id", "external_source", "external_url", "sync_status", "last_synced_at", "md_hash", "notes",
    "created_at", "updated_at", "reminder_at", "reminder_sent", "reminder_channels", "estimated_minutes",
    "actual_minutes", "started_at", "recurrence_rule", "is_recurring_instance", "recurrence_occurrence",
    "parent_recurring_id", "archived_at", "archive_reason", "parent_task_id", "calendar_event_id", "progress_percent",
] as const;
export const LEGACY_TASK_FIELDS: readonly string[] = LEGACY_TASK_COLUMNS;

/**
 * The legacy `SELECT * FROM tasks` row shape for callers that must keep their
 * HTTP/MCP response unchanged. Exact on the SQLite backend (the stored row);
 * derived from the contract fields on the API backend (SQLite-only bookkeeping
 * columns become null).
 */
export function legacyTaskRow(task: TaskRecord): Record<string, any> {
    const raw = task[RAW];
    if (raw) return { ...raw };
    const row: Record<string, any> = {};
    for (const column of LEGACY_TASK_COLUMNS) {
        switch (column) {
            case "tags": row.tags = task.tags.length ? JSON.stringify(task.tags) : null; break;
            case "reminder_sent": row.reminder_sent = task.reminder_sent ? 1 : 0; break;
            case "is_recurring_instance": row.is_recurring_instance = task.is_recurring_instance ? 1 : 0; break;
            case "sync_status": row.sync_status = task.external_source ? "synced" : "local"; break;
            case "last_synced_at": case "md_hash": row[column] = null; break;
            default: row[column] = (task as any)[column] ?? null;
        }
    }
    return row;
}

/** The legacy `SELECT * FROM task_types` row shape (exact on SQLite). */
export function legacyTaskTypeRow(type: TaskTypeRecord): Record<string, any> {
    const raw = type[RAW];
    if (raw) return { ...raw };
    return {
        id: type.id, name: type.name, description: type.description, icon: type.icon, color: type.color,
        default_status: type.default_status, allowed_statuses: JSON.stringify(type.allowed_statuses),
        custom_template: null, is_active: type.is_active ? 1 : 0, sort_order: type.sort_order, created_at: null,
    };
}

/** SQL LIKE (ASCII case-insensitive, % and _ wildcards) evaluated in TypeScript. */
export function sqlLike(value: unknown, pattern: string): boolean {
    if (value === null || value === undefined) return false;
    const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp(`^${source}$`, "is").test(String(value));
}

/** ORDER BY comparison with SQLite ordering: NULL first, numbers before text. */
export function compareValues(a: unknown, b: unknown): number {
    const rank = (value: unknown) => (value === null || value === undefined ? 0 : typeof value === "number" ? 1 : 2);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return 0;
    return (a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0;
}

/** UTC calendar date (SQLite `date('now')`), optionally shifted by whole days. */
export function utcDate(offsetDays = 0, now: Date = new Date()): string {
    return new Date(now.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// ─── SQLite backend ───────────────────────────────────────────

export class SqliteTaskStore implements TaskStore {
    constructor(private readonly db: SqliteLike) {}

    private where(filters: TaskFilters): { sql: string; params: any[] } {
        checkFilters(filters);
        const f = filters;
        const clauses = ["1 = 1"];
        const params: any[] = [];
        const add = (clause: string, ...values: any[]) => { clauses.push(clause); params.push(...values); };
        if (!f.include_archived) add("archived_at IS NULL");
        if (f.status?.length) add(`status IN (${f.status.map(() => "?").join(", ")})`, ...f.status);
        if (f.external_source) add("external_source = ?", f.external_source);
        if (f.no_external_source) add("external_source IS NULL");
        if (f.project !== undefined && f.project !== null) add("project = ?", f.project);
        if (f.category !== undefined && f.category !== null) add("category = ?", f.category);
        if (f.priority_max !== undefined && f.priority_max !== null) add("priority <= ?", f.priority_max);
        if (f.due_from) add("due_date IS NOT NULL AND substr(due_date, 1, 10) >= ?", f.due_from);
        if (f.due_before) add("due_date IS NOT NULL AND substr(due_date, 1, 10) < ?", f.due_before);
        if (f.completed_between) {
            add("completed_at IS NOT NULL AND date(completed_at, 'localtime') BETWEEN ? AND ?", ...f.completed_between);
        }
        if (f.created_between) add("date(created_at, 'localtime') BETWEEN ? AND ?", ...f.created_between);
        if (f.reminder_due_before) {
            add("reminder_at IS NOT NULL AND datetime(reminder_at) <= datetime(?) AND reminder_sent = 0", f.reminder_due_before);
        }
        if (f.missing_calendar_event) add("calendar_event_id IS NULL");
        if (f.numbers !== undefined && f.numbers !== null) {
            add(`id IN (${f.numbers.map(() => "?").join(", ") || "NULL"})`, ...f.numbers);
        }
        if (f.parent !== undefined && f.parent !== null) add("parent_task_id = ?", f.parent);
        if (f.q) {
            const needle = "%" + f.q.toLowerCase().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_") + "%";
            add("(lower(title) LIKE ? ESCAPE '\\' OR lower(coalesce(description, '')) LIKE ? ESCAPE '\\')", needle, needle);
        }
        return { sql: clauses.join(" AND "), params };
    }

    async list(filters: TaskFilters = {}): Promise<TaskRecord[]> {
        const { sql, params } = this.where(filters);
        const rows = this.db.prepare(`SELECT * FROM tasks WHERE ${sql} ORDER BY id`).all(...params);
        return rows.map((row) => {
            const record = toRecord({ ...row, number: row.id, parent_number: row.parent_task_id, parent_recurring_number: row.parent_recurring_id });
            record[RAW] = { ...row };
            return record;
        });
    }

    async stats(groupBy: GroupBy | null = null, filters: TaskFilters = {}): Promise<TaskStats> {
        const { sql, params } = this.where(filters);
        const total = Number((this.db.prepare(`SELECT count(*) AS c FROM tasks WHERE ${sql}`).get(...params) as any).c);
        if (!groupBy) return { total, groups: [] };
        if (!GROUPS.has(groupBy)) throw new Error(`cannot group by ${JSON.stringify(groupBy)}`);
        const rows = this.db.prepare(`SELECT ${groupBy} AS k, count(*) AS c FROM tasks WHERE ${sql} GROUP BY ${groupBy} ORDER BY ${groupBy}`).all(...params);
        return {
            total,
            groups: rows.map((row) => ({ key: row.k === null || row.k === undefined ? null : String(row.k), count: Number(row.c) })),
        };
    }

    async assignments(filters: AssignmentFilters = {}): Promise<TaskAssignment[]> {
        const clauses = ["1 = 1"];
        const params: any[] = [];
        for (const [column, value] of [
            ["task_id", filters.task], ["assignee_type", filters.assignee_type],
            ["assignee_id", filters.assignee_id], ["assignment_type", filters.assignment_type],
        ] as const) {
            if (value !== undefined && value !== null) { clauses.push(`${column} = ?`); params.push(value); }
        }
        const rows = this.db.prepare(
            "SELECT task_id, assignee_type, assignee_id, assignee_name, assignment_type FROM task_assignments"
            + ` WHERE ${clauses.join(" AND ")} ORDER BY task_id, id`,
        ).all(...params);
        return rows.map((row) => ({
            task: row.task_id, assignee_type: row.assignee_type || "user", assignee_id: row.assignee_id,
            assignee_name: row.assignee_name ?? null, assignment_type: row.assignment_type || "assigned",
        }));
    }

    async taskTypes({ includeInactive = false }: { includeInactive?: boolean } = {}): Promise<TaskTypeRecord[]> {
        const rows = this.db.prepare(
            "SELECT * FROM task_types WHERE (? OR is_active = 1) ORDER BY sort_order, name",
        ).all(includeInactive ? 1 : 0);
        return rows.map((row) => ({
            id: row.id, name: row.name, description: row.description ?? null, icon: row.icon ?? null,
            color: row.color ?? null, default_status: row.default_status || "todo",
            allowed_statuses: tagsList(row.allowed_statuses),
            is_active: Boolean(row.is_active ?? 1), sort_order: row.sort_order || 0, [RAW]: { ...row },
        }));
    }
}

// ─── API backend ──────────────────────────────────────────────

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<any>;
}>;

export class TaskStoreError extends Error {
    constructor(readonly status: number, readonly reason: string) {
        super(`${status}: ${reason}`);
        this.name = "TaskStoreError";
    }
}

/** Local midnight of a calendar date as an aware ISO timestamp. */
function localDayStart(day: string, addDays = 0): string {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(year, month - 1, date + addDays).toISOString();
}

export class ApiTaskStore implements TaskStore {
    private readonly baseUrl: string;

    constructor(
        baseUrl: string,
        private readonly token: string,
        private readonly opts: { channel?: string; fetch?: FetchLike; correlationId?: string } = {},
    ) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    private async call(path: string, params: Array<[string, string]>): Promise<any> {
        const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
        const doFetch: FetchLike = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
        const response = await doFetch(`${this.baseUrl}${path}${query}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${this.token}`,
                "X-Empire-Channel": this.opts.channel ?? "dashboard",
                "X-Correlation-Id": this.opts.correlationId ?? "task-store",
            },
        });
        if (!response.ok) {
            let reason = "error";
            try {
                const body = await response.json();
                const detail = body?.detail;
                if (detail && typeof detail === "object") reason = detail.reason || detail.error || reason;
            } catch { /* keep generic reason */ }
            throw new TaskStoreError(response.status, reason);
        }
        return response.json();
    }

    static params(filters: TaskFilters): Array<[string, string]> {
        checkFilters(filters);
        const params: Array<[string, string]> = [];
        for (const [key, value] of Object.entries(filters)) {
            if (value === undefined || value === null || value === false || (Array.isArray(value) && value.length === 0)) continue;
            if (key === "completed_between" || key === "created_between") {
                const [from, to] = value as [string, string];
                const prefix = key === "completed_between" ? "completed" : "created";
                params.push([`${prefix}_from`, localDayStart(from)], [`${prefix}_before`, localDayStart(to, 1)]);
            } else if (value === true) {
                params.push([key, "true"]);
            } else if (Array.isArray(value)) {
                for (const item of value) params.push([key, String(item)]);
            } else {
                params.push([key, String(value)]);
            }
        }
        if (Array.isArray(filters.numbers) && filters.numbers.length === 0) params.push(["numbers", "-1"]); // matches nothing
        return params;
    }

    private async pages(path: string, params: Array<[string, string]>, cursor: boolean, limit: number): Promise<any[]> {
        const items: any[] = [];
        let after: number | null = null;
        let offset = 0;
        for (;;) {
            const pageParams: Array<[string, string]> = [...params, ["limit", String(limit)]];
            if (cursor && after) pageParams.push(["after", String(after)]);
            if (!cursor) pageParams.push(["offset", String(offset)]);
            const page: any[] = (await this.call(path, pageParams)).items;
            items.push(...page);
            if (page.length < limit) return items;
            after = page[page.length - 1]?.number ?? null;
            offset += limit;
        }
    }

    async list(filters: TaskFilters = {}): Promise<TaskRecord[]> {
        const items = await this.pages("/v1/tasks", ApiTaskStore.params(filters), true, 200);
        return items.map((task) => toRecord({
            ...task, parent_number: task.parent_number, parent_recurring_number: task.parent_recurring_number,
        }));
    }

    async stats(groupBy: GroupBy | null = null, filters: TaskFilters = {}): Promise<TaskStats> {
        const params = ApiTaskStore.params(filters);
        if (groupBy) params.push(["group_by", groupBy]);
        const result = await this.call("/v1/tasks/stats", params);
        const groups = (result.groups as Array<{ key: string | null; count: number }>)
            .map((group) => ({ key: group.key === null || group.key === undefined ? null : String(group.key), count: Number(group.count) }))
            .sort((a, b) => compareValues(a.key, b.key));
        return { total: Number(result.total), groups };
    }

    async assignments(filters: AssignmentFilters = {}): Promise<TaskAssignment[]> {
        const params: Array<[string, string]> = [];
        if (filters.task !== undefined && filters.task !== null) params.push(["task", String(filters.task)]);
        if (filters.assignee_type) params.push(["assignee_type", ASSIGNEE_TO_API[filters.assignee_type]]);
        if (filters.assignee_id !== undefined && filters.assignee_id !== null) params.push(["assignee_ref", filters.assignee_id]);
        if (filters.assignment_type) params.push(["assignment_type", filters.assignment_type]);
        const items = await this.pages("/v1/task-assignments", params, false, 500);
        return items.map((item) => ({
            task: item.task_number, assignee_type: ASSIGNEE_FROM_API[item.assignee_type] ?? "user",
            assignee_id: item.assignee_ref, assignee_name: item.assignee_name ?? null, assignment_type: item.assignment_type,
        }));
    }

    async taskTypes({ includeInactive = false }: { includeInactive?: boolean } = {}): Promise<TaskTypeRecord[]> {
        const result = await this.call("/v1/task-types", [["include_inactive", String(includeInactive)]]);
        return (result.items as any[]).map((type) => ({
            id: type.number, name: type.name, description: type.description ?? null, icon: type.icon ?? null,
            color: type.color ?? null, default_status: type.default_status,
            allowed_statuses: type.allowed_statuses ?? [], is_active: Boolean(type.is_active), sort_order: type.sort_order || 0,
        }));
    }
}

// ─── Factory ──────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function automationToken(name: string, env: NodeJS.ProcessEnv = process.env, root: string = REPO_ROOT): string {
    const key = "EMPIRE_AUTOMATION_TOKEN_" + name.toUpperCase().replace(/-/g, "_");
    if (env[key]) return env[key] as string;
    const path = resolve(root, ".runtime", "automation-tokens", `${name}.jwt`);
    if (existsSync(path)) return readFileSync(path, "utf8").trim();
    throw new Error(`no token for automation ${JSON.stringify(name)}: set ${key} or create ${path}`);
}

export function openTaskStore(
    db: SqliteLike | null,
    automation: string = AUTOMATION_ID,
    opts: { channel?: string; env?: NodeJS.ProcessEnv; fetch?: FetchLike } = {},
): TaskStore {
    const env = opts.env ?? process.env;
    const backend = env.SOLO_EMPIRE_TASKS_BACKEND || "sqlite";
    if (backend === "sqlite") {
        if (!db) throw new Error("the sqlite backend needs a connection");
        return new SqliteTaskStore(db);
    }
    if (backend === "api") {
        return new ApiTaskStore(env.EMPIRE_TASKS_API || "http://127.0.0.1:3601", automationToken(automation, env), {
            channel: opts.channel, fetch: opts.fetch,
        });
    }
    throw new Error(`unknown SOLO_EMPIRE_TASKS_BACKEND ${JSON.stringify(backend)}`);
}
