import { z } from "zod";
import type { TaskFields, TaskLegacy, TaskStore } from "./task-store.js";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done", "blocked", "cancelled"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const unarchivedTasksWhere = "archived_at IS NULL";

export interface TaskUpdateFields {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: number;
    project?: string;
    due_date?: string;
    progress_percent?: number;
    append_notes?: string;
}

export function buildTaskUpdate(fields: TaskUpdateFields, currentStatus: TaskStatus) {
    const assignments: string[] = [];
    const values: (string | number)[] = [];
    const newStatus = fields.status ?? currentStatus;
    for (const key of [
        "title", "description", "status", "priority", "project", "due_date", "progress_percent",
    ] as const) {
        const value = fields[key];
        if (value !== undefined && !(key === "progress_percent" && newStatus === "done")) {
            assignments.push(`${key} = ?`);
            values.push(value);
        }
    }
    if (fields.append_notes !== undefined && fields.append_notes.trim() !== "") {
        assignments.push("notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END");
        values.push(fields.append_notes, fields.append_notes);
    }
    if (assignments.length === 0 && fields.progress_percent === undefined) {
        return { assignments, values };
    }
    if (newStatus === "done") {
        assignments.push("progress_percent = 100", "completed_at = COALESCE(completed_at, datetime('now'))");
    } else if (fields.status !== undefined && currentStatus === "done") {
        assignments.push("completed_at = NULL");
    }
    assignments.push("sync_status = 'dirty'", "updated_at = datetime('now')");
    return { assignments, values };
}

/** SQLite `datetime('now')` (UTC, 'YYYY-MM-DD HH:MM:SS') for legacy columns a create has to set explicitly. */
export function sqliteNow(now: Date = new Date()): string {
    return now.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Plan an update as store fields plus legacy (SQLite-only) columns, with the same rules as
 * buildTaskUpdate: done forces progress 100 and keeps the first completed_at, leaving done
 * clears completed_at, notes are appended, and every change marks the row dirty. `fields`
 * goes to the API as well; `legacy` only applies on the SQLite backend. Null when nothing changes.
 */
export function planTaskUpdate(
    fields: TaskUpdateFields,
    current: { status: string; notes: string | null },
): { fields: TaskFields; legacy: TaskLegacy } | null {
    const newStatus = fields.status ?? current.status;
    const planned: TaskFields = {};
    let any = false;
    for (const key of ["title", "description", "status", "priority", "project", "due_date", "progress_percent"] as const) {
        const value = fields[key];
        if (value === undefined) continue;
        any = true;
        if (key === "progress_percent" && newStatus === "done") continue;
        (planned as Record<string, unknown>)[key] = value;
    }
    if (fields.append_notes !== undefined && fields.append_notes.trim() !== "") {
        any = true;
        planned.notes = current.notes ? `${current.notes}\n${fields.append_notes}` : fields.append_notes;
    }
    if (!any) return null;
    const legacy: TaskLegacy = { sync_status: "dirty" };
    if (newStatus === "done") {
        legacy.progress_percent = 100;
        planned.status = "done";
    } else if (fields.status !== undefined && current.status === "done") {
        legacy.completed_at = null;
    }
    return { fields: planned, legacy };
}

export type TaskUpdateOutcome = "missing" | "empty" | "updated";

/** Shared update path of the MCP tools and the owner CLI; the one place update rules live. */
export async function updateTask(store: TaskStore, number: number, fields: TaskUpdateFields): Promise<TaskUpdateOutcome> {
    return store.exclusive(async () => {
        const current = await store.get(number);
        if (!current) return "missing";
        const plan = planTaskUpdate(fields, current);
        if (!plan) return "empty";
        await store.update(number, plan.fields, { legacy: plan.legacy });
        return "updated";
    });
}
