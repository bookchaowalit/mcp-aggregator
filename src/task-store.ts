/**
 * TaskStore adapter for the TypeScript runtimes (dashboard server, MCP server,
 * owner CLI). Mirrors infra/scripts/utils/task_store.py (reads plus the task
 * write surface: get, create, update, complete, archive, unarchive):
 *
 *   SOLO_EMPIRE_TASKS_BACKEND=api      # required; "sqlite" was retired on 2026-10-09
 *   EMPIRE_TASKS_API=https://...       # required, no default
 *   EMPIRE_AUTOMATION_TOKEN_DASHBOARD_API=...  # or .runtime/automation-tokens/dashboard-api.jwt
 *
 * Both switch values may also come from the owner-only client file
 * (~/.config/empire-platform/client.env, or $EMPIRE_CLIENT_CONFIG): a non-empty
 * env var wins, then the file; nothing configured is an error. See clientSettings().
 *
 * No other TypeScript file reads or writes the task tables directly. Tasks are
 * never hard-deleted; use archive(). Every method is async because the API backend is. Lives under mcp-server/src so both
 * `infra/tsconfig.json` (dashboard) and `infra/mcp-server/tsconfig.json`
 * (rootDir: src) can import it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AUTOMATION_ID = "dashboard-api";

/** Raw legacy row/table data a record was built from (SQLite test double only). */
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

/** Columns a writer may set through the store (same set as task_store.py FIELDS). */
export interface TaskFields {
    title?: string;
    description?: string | null;
    status?: string;
    priority?: number;
    project?: string | null;
    tags?: string[] | string | null;
    category?: string | null;
    due_date?: string | null;
    notes?: string | null;
    estimated_minutes?: number | null;
    actual_minutes?: number;
    started_at?: string | null;
    reminder_at?: string | null;
    reminder_channels?: string | null;
    recurrence_rule?: string | null;
    external_url?: string | null;
    calendar_event_id?: string | null;
    progress_percent?: number;
}

/** create() also accepts the parent task number (the API takes its uuid, resolved by the adapter). */
export interface TaskCreateFields extends TaskFields {
    parent_task_id?: number | null;
}

/** SQLite-only bookkeeping columns (sync_status, completed_at, ...) a legacy writer sets; ignored by the API backend. */
export type TaskLegacy = Record<string, string | number | null>;

export interface RoleSuggestion {
    task: number;
    role_id: string;
    confidence: string | null;
    match_reason: string | null;
    review_status: string;
    source_registry: string | null;
    updated_at: string | null;
}

export interface RoleSuggestionFilters {
    task?: number;
    role_id?: string;
    source_registry?: string;
    review_status?: string;
    confidence?: string;
}

export interface TaskStore {
    /**
     * Runs fn while holding the per-backend lock, so a read-modify-write (or check-then-create)
     * cannot interleave with another one on the same database or Tasks API. Not re-entrant.
     */
    exclusive<T>(fn: () => Promise<T>): Promise<T>;
    /** One task by number, archived included; null when it does not exist. */
    get(number: number): Promise<TaskRecord | null>;
    /** Returns the new task number. */
    create(fields: TaskCreateFields, opts?: { legacy?: TaskLegacy }): Promise<number>;
    /** status 'done' goes through complete(); PATCH on the API cannot set it. */
    update(number: number, fields: TaskFields, opts?: { legacy?: TaskLegacy }): Promise<void>;
    complete(number: number, opts?: { legacy?: TaskLegacy }): Promise<void>;
    archive(number: number, reason: string): Promise<void>;
    unarchive(number: number): Promise<void>;
    roleSuggestions(filters?: RoleSuggestionFilters): Promise<RoleSuggestion[]>;
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
export const FIELD_KEYS = new Set([
    "title", "description", "status", "priority", "project", "tags", "category", "due_date", "notes",
    "estimated_minutes", "actual_minutes", "started_at", "reminder_at", "reminder_channels",
    "recurrence_rule", "external_url", "calendar_event_id", "progress_percent",
]);
const ASSIGNEE_TO_API = { user: "identity", role: "role", team: "team" } as const;
const ASSIGNEE_FROM_API: Record<string, TaskAssignment["assignee_type"]> = { identity: "user", role: "role", team: "team" };

export function checkFilters(filters: TaskFilters): void {
    const unknown = Object.keys(filters).filter((key) => !FILTER_KEYS.has(key));
    if (unknown.length) throw new Error(`unknown task filters: ${unknown.sort().join(", ")}`);
}

export function checkFields(fields: object, allowed: Set<string>): void {
    const unknown = Object.keys(fields).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error(`unknown task fields: ${unknown.sort().join(", ")}`);
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
export function toRecord(row: Record<string, any>): TaskRecord {
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
 * The legacy task row shape (every column of the retired table) for callers that must keep their
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

/** The legacy legacy task-type row shape (exact on SQLite). */
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

// ─── Serialization ────────────────────────────────────────────

/** Promise-chain mutex. Stores are created per request, so the lock is keyed by the shared resource. */
export class AsyncMutex {
    private tail: Promise<unknown> = Promise.resolve();

    run<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.tail.then(fn, fn);
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
}

const apiLocks = new Map<string, AsyncMutex>();

export function lockFor<K>(map: { get(k: K): AsyncMutex | undefined; set(k: K, v: AsyncMutex): unknown }, key: K): AsyncMutex {
    let lock = map.get(key);
    if (!lock) { lock = new AsyncMutex(); map.set(key, lock); }
    return lock;
}

// ─── API backend ──────────────────────────────────────────────

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; redirect?: "error" }) => Promise<{
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

    exclusive<T>(fn: () => Promise<T>): Promise<T> {
        return lockFor(apiLocks, this.baseUrl).run(fn);
    }

    /** uuid by task number; the write endpoints address tasks by uuid. */
    private readonly ids = new Map<number, string>();

    private async request(method: string, path: string, params: Array<[string, string]> = [], body?: unknown): Promise<any> {
        const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
        const doFetch: FetchLike = this.opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
            "X-Empire-Channel": this.opts.channel ?? "dashboard",
            "X-Correlation-Id": this.opts.correlationId ?? "task-store",
        };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const response = await doFetch(`${this.baseUrl}${path}${query}`, {
            method, headers, redirect: "error", // never forward the Bearer token to a redirect target
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) {
            let reason = "error";
            try {
                const parsed = await response.json();
                const detail = parsed?.detail;
                if (detail && typeof detail === "object") reason = detail.reason || detail.error || reason;
            } catch { /* keep generic reason */ }
            throw new TaskStoreError(response.status, reason);
        }
        if (method === "GET") return response.json();
        try { return await response.json(); } catch { return null; } // a write may answer with an empty body
    }

    private call(path: string, params: Array<[string, string]>): Promise<any> {
        return this.request("GET", path, params);
    }

    private remember(task: any): TaskRecord {
        this.ids.set(task.number, task.id);
        return toRecord({ ...task, parent_number: task.parent_number, parent_recurring_number: task.parent_recurring_number });
    }

    private async uuid(number: number): Promise<string> {
        if (!this.ids.has(number)) this.remember(await this.request("GET", `/v1/tasks/number/${number}`));
        return this.ids.get(number) as string;
    }

    private async body(fields: TaskCreateFields): Promise<Record<string, any>> {
        checkFields(fields, new Set([...FIELD_KEYS, "parent_task_id"]));
        const body: Record<string, any> = {};
        for (const [key, value] of Object.entries(fields)) if (value !== undefined) body[key] = value;
        if ("tags" in body) body.tags = tagsList(body.tags);
        if (body.due_date !== undefined && body.due_date !== null) body.due_date = dateOnly(body.due_date);
        if (body.parent_task_id !== undefined && body.parent_task_id !== null) body.parent_task_id = await this.uuid(body.parent_task_id);
        return body;
    }

    async get(number: number): Promise<TaskRecord | null> {
        try {
            return this.remember(await this.request("GET", `/v1/tasks/number/${number}`));
        } catch (error) {
            if (error instanceof TaskStoreError && error.status === 404) return null;
            throw error;
        }
    }

    async create(fields: TaskCreateFields, _opts: { legacy?: TaskLegacy } = {}): Promise<number> {
        const body = await this.body(fields);
        const status = body.status;
        delete body.status;
        const number = this.remember(await this.request("POST", "/v1/tasks", [], body)).id;
        if (status && status !== "todo") await this.update(number, { status });
        return number;
    }

    async update(number: number, fields: TaskFields, _opts: { legacy?: TaskLegacy } = {}): Promise<void> {
        checkFields(fields, FIELD_KEYS);
        const body = await this.body(fields);
        const done = body.status === "done";
        if (done) delete body.status;
        if (Object.keys(body).length) await this.request("PATCH", `/v1/tasks/${await this.uuid(number)}`, [], body);
        if (done) await this.complete(number);
    }

    async complete(number: number, _opts: { legacy?: TaskLegacy } = {}): Promise<void> {
        await this.request("POST", `/v1/tasks/${await this.uuid(number)}/complete`);
    }

    async archive(number: number, reason: string): Promise<void> {
        await this.request("POST", `/v1/tasks/${await this.uuid(number)}/archive`, [], { reason });
    }

    async unarchive(number: number): Promise<void> {
        await this.request("POST", `/v1/tasks/${await this.uuid(number)}/unarchive`);
    }

    async roleSuggestions(filters: RoleSuggestionFilters = {}): Promise<RoleSuggestion[]> {
        const params: Array<[string, string]> = [];
        for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null) params.push([key, String(value)]);
        const items = await this.pages("/v1/task-role-suggestions", params, false, 500);
        return items.map((item) => ({
            task: item.task_number, role_id: item.role_id, confidence: item.confidence ?? null, match_reason: item.match_reason ?? null,
            review_status: item.review_status, source_registry: item.source_registry ?? null, updated_at: item.updated_at ?? null,
        }));
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
        return items.map((task) => this.remember(task));
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

/** Token files are looked up in <repo>/.runtime/automation-tokens, then ~/.config/empire-platform/tokens. */
export function automationToken(
    name: string, env: NodeJS.ProcessEnv = process.env, root: string = REPO_ROOT, home: string = homedir(),
): string {
    const key = "EMPIRE_AUTOMATION_TOKEN_" + name.toUpperCase().replace(/-/g, "_");
    if (env[key]) return env[key] as string;
    const first = resolve(root, ".runtime", "automation-tokens", `${name}.jwt`);
    for (const path of [first, resolve(home, ".config", "empire-platform", "tokens", `${name}.jwt`)]) {
        if (!existsSync(path)) continue;
        const mode = statSync(path).mode;
        if (mode & 0o077) throw new Error(`refusing token file ${path}: mode ${(mode & 0o777).toString(8)} is group/world accessible; run chmod 600`);
        return readFileSync(path, "utf8").trim();
    }
    throw new Error(`no token for automation ${JSON.stringify(name)}: set ${key} or create ${first}`);
}

/** https, or http to a loopback host only; the message never echoes the URL (it may carry credentials). */
export function validateApiUrl(url: string, name: string = "EMPIRE_TASKS_API"): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`${name} is not a valid URL`);
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === "https:" && host) return url;
    if (parsed.protocol === "http:" && ["127.0.0.1", "[::1]", "::1", "localhost"].includes(host)) return url;
    throw new Error(`${name} must be an https URL (http only for 127.0.0.1, ::1 or localhost)`);
}

// ─── Client config file ───────────────────────────────────────

const CLIENT_KEYS = ["SOLO_EMPIRE_TASKS_BACKEND", "EMPIRE_TASKS_API", "EMPIRE_HABITS_API", "EMPIRE_GOALS_API",
    "EMPIRE_PROJECTS_API", "EMPIRE_ROLES_SKILLS_API", "EMPIRE_OPERATING_API", "EMPIRE_INTAKE_API", "EMPIRE_AUTOMATION_API"];

export const SQLITE_RETIRED =
    "the SQLite task backend was retired on 2026-10-09; tasks live in the Tasks API";

export interface ClientSettings {
    backend: "api";
    apiUrl: string;
    backendSource: "env" | "file";
    apiUrlSource: "env" | "file";
    path: string;
}

export function clientConfigPath(env: NodeJS.ProcessEnv = process.env): string {
    const override = (env.EMPIRE_CLIENT_CONFIG || "").trim();
    return override ? resolve(override) : resolve(homedir(), ".config", "empire-platform", "client.env");
}

function readClientFile(path: string): Record<string, string> {
    let mode: number;
    try {
        mode = statSync(path).mode;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
    if (mode & 0o077) {
        throw new Error(`refusing client config ${path}: mode ${(mode & 0o777).toString(8)} is group/world accessible; run chmod 600`);
    }
    const values: Record<string, string> = {};
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const at = line.indexOf("=");
        const key = line.slice(0, at).trim();
        let value = line.slice(at + 1).trim();
        if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
        if (CLIENT_KEYS.includes(key)) values[key] = value;
    }
    return values;
}

/** One allowlisted client setting: non-empty env, else the client file; "" when unset. */
export function clientValue(key: string, env: NodeJS.ProcessEnv = process.env): string {
    if (!CLIENT_KEYS.includes(key)) throw new Error(`${key} is not a client setting`);
    if ((env[key] || "").trim()) return (env[key] as string).trim();
    return readClientFile(clientConfigPath(env))[key] || "";
}

/**
 * Effective backend and API URL: non-empty env, else the client file. Never a token.
 * Nothing configured, a "sqlite" backend, or an api backend without a URL is an error.
 */
export function clientSettings(env: NodeJS.ProcessEnv = process.env): ClientSettings {
    const path = clientConfigPath(env);
    const file = readClientFile(path);
    const pick = (key: string): [string, "env" | "file" | null] => {
        if ((env[key] || "").trim()) return [(env[key] as string).trim(), "env"];
        if (file[key]) return [file[key], "file"];
        return ["", null];
    };
    const [backend, backendSource] = pick("SOLO_EMPIRE_TASKS_BACKEND");
    const [apiUrl, apiUrlSource] = pick("EMPIRE_TASKS_API");
    if (backend === "sqlite") throw new Error(SQLITE_RETIRED);
    if (!backend || !backendSource) {
        throw new Error(
            `no task backend configured: set SOLO_EMPIRE_TASKS_BACKEND=api and EMPIRE_TASKS_API in ${path} or the environment`,
        );
    }
    if (backend !== "api") throw new Error(`unknown SOLO_EMPIRE_TASKS_BACKEND ${JSON.stringify(backend)}`);
    if (!apiUrl || !apiUrlSource) {
        throw new Error(`the api backend needs EMPIRE_TASKS_API: set it in ${path} or the environment (sets no EMPIRE_TASKS_API)`);
    }
    validateApiUrl(apiUrl);
    return { backend: "api", apiUrl, backendSource, apiUrlSource, path };
}

/** Test seam: replaces the store openTaskStore returns (in-process only; no env or file selects it). */
let storeOverride: ((automation: string) => TaskStore) | null = null;
export function overrideTaskStoreForTests(factory: ((automation: string) => TaskStore) | null): void {
    storeOverride = factory;
}

/** Always the Tasks API store. */
export function openTaskStore(
    automation: string = AUTOMATION_ID,
    opts: { channel?: string; env?: NodeJS.ProcessEnv; fetch?: FetchLike } = {},
): TaskStore {
    if (storeOverride) return storeOverride(automation);
    const env = opts.env ?? process.env;
    const { apiUrl } = clientSettings(env);
    return new ApiTaskStore(apiUrl, automationToken(automation, env), { channel: opts.channel, fetch: opts.fetch });
}
