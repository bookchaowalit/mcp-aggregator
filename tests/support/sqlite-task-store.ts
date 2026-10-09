/**
 * Test double: the retired SQLite task backend, kept verbatim so the behaviour
 * tests can still run against a fixture database. Production code must never
 * import this file (the SQLite task backend was retired on 2026-10-09).
 */
import {
    RAW, checkFields, checkFilters, FIELD_KEYS, lockFor, tagsList, toRecord,
    type AssignmentFilters, type AsyncMutex, type GroupBy, type RoleSuggestion, type RoleSuggestionFilters,
    type TaskAssignment, type TaskCreateFields, type TaskFields, type TaskFilters, type TaskLegacy, type TaskRecord,
    type TaskStats, type TaskStore, type TaskTypeRecord,
} from "../../src/task-store.js";

/** Minimal better-sqlite3 surface so this module needs no native import. */
export interface SqliteLike {
    prepare(sql: string): {
        all(...params: any[]): any[];
        get(...params: any[]): any;
        run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    };
}

/** Frozen copy of the retired task tables, for fixture databases (schema.sql no longer carries them). */
export const TASKS_DDL = `CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT CHECK(status IN ('todo', 'in_progress', 'done', 'blocked', 'cancelled')) DEFAULT 'todo',
    priority INTEGER DEFAULT 3 CHECK(priority >= 1 AND priority <= 5),
    project TEXT,
    tags TEXT,
    category TEXT,
    due_date DATE,
    completed_at DATETIME,
    external_id TEXT,
    external_source TEXT,
    external_url TEXT,
    sync_status TEXT CHECK(sync_status IN ('local', 'synced', 'dirty', 'conflict')) DEFAULT 'local',
    last_synced_at DATETIME,
    md_hash TEXT,

    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reminder_at DATETIME,
    reminder_sent BOOLEAN DEFAULT 0,
    reminder_channels TEXT,
    estimated_minutes INTEGER,
    actual_minutes INTEGER DEFAULT 0,
    started_at DATETIME,
    recurrence_rule TEXT,
    is_recurring_instance BOOLEAN DEFAULT 0,
    recurrence_occurrence INTEGER,
    parent_recurring_id INTEGER REFERENCES tasks(id),
    archived_at DATETIME,
    archive_reason TEXT,
    parent_task_id INTEGER,
    calendar_event_id TEXT,
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent >= 0 AND progress_percent <= 100)
);`;
export const TASK_ROLE_SUGGESTIONS_DDL = `CREATE TABLE task_role_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
    match_reason TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'suggested' CHECK(review_status IN ('suggested', 'accepted', 'dismissed')),
    source_registry TEXT NOT NULL DEFAULT 'docs/ROLE-TASK-ROUTING.yaml',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, role_id, source_registry)
);`;

const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;
const GROUPS = new Set(["status", "priority", "project", "category"]);
const dbLocks = new WeakMap<object, AsyncMutex>();

export class SqliteTaskStore implements TaskStore {
    constructor(private readonly db: SqliteLike) {}

    exclusive<T>(fn: () => Promise<T>): Promise<T> {
        return lockFor(dbLocks, this.db as object).run(fn);
    }

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

    private static record(row: Record<string, any>): TaskRecord {
        const record = toRecord({ ...row, number: row.id, parent_number: row.parent_task_id, parent_recurring_number: row.parent_recurring_id });
        record[RAW] = { ...row };
        return record;
    }

    async list(filters: TaskFilters = {}): Promise<TaskRecord[]> {
        const { sql, params } = this.where(filters);
        const rows = this.db.prepare(`SELECT * FROM tasks WHERE ${sql} ORDER BY id`).all(...params);
        return rows.map((row) => SqliteTaskStore.record(row));
    }

    async get(number: number): Promise<TaskRecord | null> {
        const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(number);
        return row ? SqliteTaskStore.record(row) : null;
    }

    private static values(fields: TaskCreateFields, legacy?: TaskLegacy): Record<string, any> {
        const values: Record<string, any> = {};
        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined) continue;
            values[key] = key === "tags" && Array.isArray(value) ? JSON.stringify(value) : value;
        }
        for (const [key, value] of Object.entries(legacy ?? {})) {
            if (!COLUMN_NAME.test(key)) throw new Error(`invalid legacy column ${JSON.stringify(key)}`);
            values[key] = value;
        }
        return values;
    }

    /** `legacy` may carry SQLite-only columns, including explicit created_at/updated_at (else the column defaults apply). */
    async create(fields: TaskCreateFields, { legacy }: { legacy?: TaskLegacy } = {}): Promise<number> {
        checkFields(fields, new Set([...FIELD_KEYS, "parent_task_id"]));
        const values = { status: "todo", ...SqliteTaskStore.values(fields, legacy) };
        const columns = Object.keys(values);
        const result = this.db.prepare(
            `INSERT INTO tasks (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ).run(...Object.values(values));
        return Number(result.lastInsertRowid);
    }

    async update(number: number, fields: TaskFields, { legacy }: { legacy?: TaskLegacy } = {}): Promise<void> {
        checkFields(fields, FIELD_KEYS);
        const values = SqliteTaskStore.values(fields, legacy);
        if (values.status === "done") {
            const { status: _status, ...rest } = values;
            await this.complete(number, { legacy: Object.keys(rest).length ? rest : undefined });
            return;
        }
        const columns = Object.keys(values);
        if (!columns.length) return;
        const stamp = "updated_at" in values ? "" : ", updated_at = datetime('now')";
        this.db.prepare(`UPDATE tasks SET ${columns.map((column) => `${column} = ?`).join(", ")}${stamp} WHERE id = ?`)
            .run(...Object.values(values), number);
    }

    async complete(number: number, { legacy }: { legacy?: TaskLegacy } = {}): Promise<void> {
        const extra = SqliteTaskStore.values({}, legacy);
        const hasCompleted = "completed_at" in extra;
        const completedParams = hasCompleted ? [extra.completed_at] : [];
        delete extra.completed_at;
        const stamp = "updated_at" in extra ? "" : ", updated_at = datetime('now')";
        const assignments = Object.keys(extra).map((column) => `, ${column} = ?`).join("");
        this.db.prepare(
            `UPDATE tasks SET status = 'done', completed_at = ${hasCompleted ? "?" : "COALESCE(completed_at, datetime('now'))"}${stamp}${assignments} WHERE id = ?`,
        ).run(...completedParams, ...Object.values(extra), number);
    }

    async archive(number: number, reason: string): Promise<void> {
        this.db.prepare(
            "UPDATE tasks SET archived_at = COALESCE(archived_at, datetime('now')), archive_reason = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(reason, number);
    }

    async unarchive(number: number): Promise<void> {
        this.db.prepare("UPDATE tasks SET archived_at = NULL, archive_reason = NULL, updated_at = datetime('now') WHERE id = ?").run(number);
    }

    async roleSuggestions(filters: RoleSuggestionFilters = {}): Promise<RoleSuggestion[]> {
        const clauses = ["1 = 1"];
        const params: any[] = [];
        for (const [column, value] of [
            ["task_id", filters.task], ["role_id", filters.role_id], ["source_registry", filters.source_registry],
            ["review_status", filters.review_status], ["confidence", filters.confidence],
        ] as const) {
            if (value !== undefined && value !== null) { clauses.push(`${column} = ?`); params.push(value); }
        }
        const rows = this.db.prepare(
            "SELECT task_id, role_id, confidence, match_reason, review_status, source_registry, updated_at"
            + ` FROM task_role_suggestions WHERE ${clauses.join(" AND ")} ORDER BY task_id, role_id, id`,
        ).all(...params);
        return rows.map((row) => ({
            task: row.task_id, role_id: row.role_id, confidence: row.confidence ?? null, match_reason: row.match_reason ?? null,
            review_status: row.review_status, source_registry: row.source_registry ?? null, updated_at: row.updated_at ?? null,
        }));
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
