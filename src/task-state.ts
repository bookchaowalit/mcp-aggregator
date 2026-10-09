import { z } from "zod";

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
