import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { sqliteNow, taskStatusSchema, updateTask } from "../task-state.js";
import { compareValues, legacyTaskRow, openTaskStore, type TaskRecord, type TaskStore } from "../task-store.js";

const AUTOMATION = "legacy-mcp";
const CHANNEL = "mcp";

type Row = Record<string, any>;

/** SQL GROUP BY over rows already in memory: [{<key>: value, c: count}] ordered by key (NULL first). */
function groupCount(rows: Row[], key: string): Row[] {
    const counts = new Map<unknown, number>();
    for (const row of rows) counts.set(row[key] ?? null, (counts.get(row[key] ?? null) ?? 0) + 1);
    return [...counts.entries()]
        .sort(([a], [b]) => compareValues(a, b))
        .map(([value, c]) => ({ [key]: value, c }));
}

export function registerTasksTools({
    server,
    getDb,
}: Pick<ToolContext, "server" | "getDb">): void {

    /** The SQLite connection is only needed (and opened) on the sqlite backend. */
    async function openStore(): Promise<TaskStore> {
        const sqlite = (process.env.SOLO_EMPIRE_TASKS_BACKEND || "sqlite") === "sqlite";
        return openTaskStore(sqlite ? await getDb() : null, AUTOMATION, { channel: CHANNEL });
    }

    server.tool(
        "list_tasks",
        "List all tasks from the local task management system. Supports filtering by status, project, and priority.",
        {
            status: taskStatusSchema.optional(),
            project: z.string().optional(),
            priority: z.number().min(1).max(5).optional(),
            parent_task_id: z.number().int().optional().describe("Only subtasks of this task"),
            limit: z.number().min(1).max(100).default(50),
        },
        async (params) => {
            const store = await openStore();
            let found = await store.list({
                ...(params.status ? { status: [params.status] } : {}),
                ...(params.project ? { project: params.project } : {}),
                ...(params.parent_task_id !== undefined ? { parent: params.parent_task_id } : {}),
            });
            if (params.priority) found = found.filter((task) => task.priority === params.priority);
            // ORDER BY priority ASC, created_at DESC LIMIT ? (ties keep id order)
            found.sort((a, b) => a.priority - b.priority || compareValues(b.created_at, a.created_at));
            const tasks = found.slice(0, params.limit).map(legacyTaskRow);
            return {
                content: [{ type: "text", text: JSON.stringify({ total: tasks.length, tasks }, null, 2) }],
            };
        },
    );

    server.tool(
        "create_task",
        "Create a new local task. Employer work is managed in nexatech-empire and is not synced here.",
        {
            title: z.string().describe("Task title"),
            description: z.string().optional().describe("Task description"),
            status: z.enum(["todo", "in_progress", "done", "blocked"]).default("todo"),
            priority: z.number().min(1).max(5).default(3).describe("1=highest, 5=lowest"),
            project: z.string().optional(),
            category: z.string().optional().describe("income, ops, learning, health, creative, admin"),
            due_date: z.string().optional().describe("Due date YYYY-MM-DD"),
            tags: z.string().optional().describe("Comma-separated tags"),
            parent_task_id: z.number().int().optional().describe("Parent task ID; makes this a subtask"),
            reuse_open: z.boolean().default(false).describe("Return an existing open task with the same title, project, and parent instead of creating a duplicate"),
        },
        async (params) => {
            const store = await openStore();
            const parentId = params.parent_task_id ?? null;
            if (parentId !== null) {
                const parent = await store.get(parentId);
                if (!parent || parent.archived_at) {
                    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `Parent task ${parentId} not found` }) }] };
                }
            }
            const outcome = await store.exclusive(async () => {
                if (params.reuse_open) {
                    const candidates = await store.list({
                        q: params.title,
                        ...(params.project ? { project: params.project } : {}),
                        ...(parentId !== null ? { parent: parentId } : {}),
                    });
                    const existing = candidates.find((task: TaskRecord) =>
                        !["done", "cancelled"].includes(task.status) && task.title === params.title
                        && task.project === (params.project || null) && task.parent_task_id === parentId);
                    if (existing) {
                        return { reused: legacyTaskRow(existing) };
                    }
                }
                const done = params.status === "done";
                const number = await store.create({
                    title: params.title,
                    ...(params.description ? { description: params.description } : {}),
                    status: params.status,
                    priority: params.priority,
                    ...(params.project ? { project: params.project } : {}),
                    ...(params.category ? { category: params.category } : {}),
                    ...(params.due_date ? { due_date: params.due_date } : {}),
                    ...(params.tags ? { tags: params.tags.split(",").map(t => t.trim()) } : {}),
                    ...(parentId !== null ? { parent_task_id: parentId } : {}),
                }, { legacy: { sync_status: "local", progress_percent: done ? 100 : 0, ...(done ? { completed_at: sqliteNow() } : {}) } });
                return { number };
            });
            if ("reused" in outcome) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ success: true, reused: true, task: outcome.reused, message: "Existing open task reused." }, null, 2) }],
                };
            }
            const number = outcome.number;
            const task = legacyTaskRow((await store.get(number)) as TaskRecord);
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, task, message: "Task created locally. Personal sources can be synced separately." }, null, 2) }],
            };
        },
    );

    server.tool(
        "update_task",
        "Update an existing local task. Employer work is managed in nexatech-empire.",
        {
            id: z.number().describe("Task ID"),
            title: z.string().optional(),
            description: z.string().optional(),
            status: taskStatusSchema.optional(),
            priority: z.number().min(1).max(5).optional(),
            project: z.string().optional(),
            due_date: z.string().optional(),
            append_notes: z.string().optional().describe("Text appended as a new line to the task notes, e.g. commit SHAs, review findings, models, metrics"),
        },
        async (params) => {
            const store = await openStore();
            const { id, ...fields } = params;
            const outcome = await updateTask(store, id, fields);
            if (outcome === "missing") {
                return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `Task ${id} not found` }) }] };
            }
            if (outcome === "empty") {
                return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
            }
            const updated = legacyTaskRow((await store.get(id)) as TaskRecord);
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, task: updated, message: "Task updated. Run sync to push changes." }, null, 2) }],
            };
        },
    );

    server.tool(
        "complete_task",
        "Mark a local task as done.",
        { id: z.number().describe("Task ID") },
        async (params) => {
            const store = await openStore();
            if ((await updateTask(store, params.id, { status: "done" })) === "missing") {
                return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `Task ${params.id} not found` }) }] };
            }
            const updated = legacyTaskRow((await store.get(params.id)) as TaskRecord);
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, task: updated }, null, 2) }],
            };
        },
    );

    server.tool(
        "delete_task",
        "Archive a local task (tasks are never hard-deleted; the archive reason is recorded). External employer records are managed outside Solo Empire.",
        { id: z.number().describe("Task ID") },
        async (params) => {
            const store = await openStore();
            const task = await store.get(params.id);
            if (!task) {
                return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `Task ${params.id} not found` }) }] };
            }
            await store.archive(params.id, "deleted via MCP delete_task");
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, deleted: task.title, archived: true, message: "Task archived (not hard-deleted); it is hidden from task lists.", warning: task.external_id ? "External record is managed outside Solo Empire" : undefined }, null, 2) }],
            };
        },
    );

    server.tool(
        "task_sync_status",
        "Show task sync status — personal sources (Todoist/Jira/Notion), sync state, and project. Employer work is external.",
        {},
        async () => {
            const store = await openStore();
            const rows = (await store.list()).map(legacyTaskRow);
            const total = { c: rows.length };
            const byStatus = groupCount(rows, "status");
            const bySync = groupCount(rows, "sync_status");
            const byProject = groupCount(rows.filter((row) => row.project !== null), "project")
                .sort((a, b) => b.c - a.c);
            const bySource = groupCount(rows.filter((row) => row.external_source !== null), "external_source");
            const workCount = rows.filter((row) => row.external_source === "leantime").length;
            const personalCount = rows.filter((row) => row.external_source === null || row.external_source !== "leantime").length;
            const dirty = rows
                .filter((row) => ["dirty", "conflict"].includes(row.sync_status))
                .sort((a, b) => compareValues(a.priority, b.priority))
                .map((row) => ({ id: row.id, title: row.title, sync_status: row.sync_status, external_source: row.external_source }));
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        total: total.c,
                        work_nexatech: workCount,
                        personal: personalCount,
                        by_status: byStatus,
                        by_sync: bySync,
                        by_project: byProject,
                        by_source: bySource,
                        needs_sync: dirty,
                    }, null, 2),
                }],
            };
        },
    );

}
