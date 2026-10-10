/**
 * Test double: the retired portfolio tables behind the CellStore interface (goals, projects, roles-skills).
 * Mirrors infra/tests/support/sqlite_cell_store.py. Production code must never import this file: the goals,
 * projects and roles-skills data live in their cells since 2026-10-10.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CellStoreError, type CellRecord, type CellStore, type Filters } from "../../src/cell-store.js";
import type { SqliteLike } from "./sqlite-task-store.js";

const LEGACY_DDL = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/support/legacy_portfolio_tables.sql");
const LEGACY_DDL_2 = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/support/legacy_operating_intake_automation_tables.sql");

// plural -> [cell, legacy table, id column, order column, bool columns]
const RESOURCES: Record<string, [string, string, string, string, string[]]> = {
    "goals": ["goals", "goals", "id", "id", []],
    "goal-tasks": ["goals", "goal_tasks", "id", "sort_order", []],
    "goal-metrics": ["goals", "goal_metrics", "id", "id", []],
    "goal-portfolio-mappings": ["goals", "goal_portfolio_mappings", "goal_id", "goal_id", []],
    "productivity-goals": ["goals", "productivity_goals", "id", "id", ["is_active"]],
    "goal-project-links": ["goals", "goal_project_links", "id", "id", []],
    "goal-context-links": ["goals", "goal_context_links", "id", "id", []],
    "goal-task-project-links": ["goals", "goal_task_project_links", "id", "id", []],
    "projects": ["projects", "projects", "id", "id", []],
    "project-repos": ["projects", "project_repos", "id", "id", ["is_primary"]],
    "portfolio-contexts": ["projects", "portfolio_contexts", "id", "id", []],
    "project-context-links": ["projects", "project_context_links", "id", "id", []],
    "work-items": ["projects", "portfolio_work_items", "id", "id", []],
    "work-item-task-links": ["projects", "work_item_task_links", "id", "id", []],
    "work-item-goal-task-links": ["projects", "work_item_goal_task_links", "id", "id", []],
    "personal-roles": ["roles-skills", "personal_roles", "id", "id", []],
    "personal-role-context-links": ["roles-skills", "personal_role_context_links", "id", "id", []],
    "personal-role-goal-links": ["roles-skills", "personal_role_goal_links", "id", "id", []],
    "personal-role-project-links": ["roles-skills", "personal_role_project_links", "id", "id", []],
    "personal-role-task-links": ["roles-skills", "personal_role_task_links", "id", "id", []],
    "role-goal-links": ["roles-skills", "role_goal_links", "id", "id", []],
    "skill-categories": ["roles-skills", "skill_categories", "id", "sort_order", []],
    "skills": ["roles-skills", "skills", "id", "id", ["revenue_relevant"]],
    "role-path-steps": ["roles-skills", "role_path_steps", "id", "id", []],
    "role-project-allocations": ["roles-skills", "role_project_allocations", "id", "id", []],
    "role-skill-links": ["roles-skills", "role_skill_links", "id", "id", []],
    "cycles": ["operating", "operating_cycles", "id", "start_date", []],
    "cycle-tasks": ["operating", "operating_cycle_tasks", "id", "id", ["evidence_required"]],
    "cycle-goal-links": ["operating", "operating_cycle_goal_links", "id", "id", []],
    "cycle-reviews": ["operating", "operating_cycle_reviews", "id", "id", []],
    "kpis": ["operating", "operating_kpi_definitions", "id", "id", []],
    "kpi-measurements": ["operating", "operating_kpi_measurements", "id", "id", []],
    "sources": ["intake", "source_registry", "id", "id", []],
    "intakes": ["intake", "intake_queue", "id", "id", []],
    "intake-events": ["intake", "intake_events", "id", "id", []],
    "cron-jobs": ["automation", "cron_jobs", "id", "id", ["is_active"]],
    "automation-rules": ["automation", "automation_rules", "id", "id", ["is_active"]],
    "workflow-pipelines": ["automation", "workflow_pipelines", "id", "id", ["is_active"]],
    "automation-log": ["automation", "automation_log", "id", "id", ["success"]],
};

export interface SqliteDb extends SqliteLike {
    exec(sql: string): unknown;
}

export class SqliteCellStore implements CellStore {
    constructor(private readonly db: SqliteDb, readonly cell: string) {
        // CREATE ... IF NOT EXISTS: a fixture's own (minimal) tables win, so an index on a column they lack is skipped.
        for (const statement of [LEGACY_DDL, LEGACY_DDL_2].flatMap((file) => readFileSync(file, "utf-8").split(/;[ \t]*\r?\n/))) {
            if (!statement.replace(/--.*$/gm, "").trim()) continue;
            try {
                db.exec(statement);
            } catch (error: any) {
                if (!/no such column/.test(String(error?.message))) throw error;
            }
        }
    }

    private resource(plural: string): [string, string, string, string[]] {
        const entry = RESOURCES[plural];
        if (!entry || entry[0] !== this.cell) throw new CellStoreError(404, `no resource ${plural} in ${this.cell}`, this.cell);
        return [entry[1], entry[2], entry[3], entry[4]];
    }

    private columns(table: string): Set<string> {
        return new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((row: any) => row.name));
    }

    private out(row: any, key: string, bools: string[]): CellRecord | null {
        if (!row) return null;
        const data: any = { ...row };
        data.id ??= data[key];
        data.legacy_id = data[key];
        data.version ??= 1;
        for (const name of bools) if (data[name] !== null && data[name] !== undefined) data[name] = Boolean(data[name]);
        return data;
    }

    async list(plural: string, filters: Filters = {}, order: "asc" | "desc" = "asc"): Promise<CellRecord[]> {
        const [table, key, orderColumn, bools] = this.resource(plural);
        const columns = this.columns(table);
        const where = ["1=1"];
        const params: unknown[] = [];
        const { null: nulls, ...equality } = filters as Record<string, any>;
        for (const [name, value] of Object.entries(equality)) {
            if (value === undefined || value === null) continue;
            const column = name === "id" || name === "legacy_id" ? key : name;
            if (!columns.has(column)) throw new CellStoreError(422, `unknown_filter:${name}`, this.cell);
            const values = (Array.isArray(value) ? value : [value]).map((v) => (typeof v === "boolean" ? Number(v) : v));
            where.push(`${column} IN (${values.map(() => "?").join(",")})`);
            params.push(...values);
        }
        for (const name of nulls ? (Array.isArray(nulls) ? nulls : [nulls]) : []) where.push(`${name} IS NULL`);
        const direction = order === "desc" ? "DESC" : "ASC";
        const sort = orderColumn !== key ? `${orderColumn} ${direction}, ${key} ${direction}` : `${key} ${direction}`;
        const rows = this.db.prepare(`SELECT * FROM ${table} WHERE ${where.join(" AND ")} ORDER BY ${sort}`).all(...params);
        return rows.map((row) => this.out(row, key, bools)!);
    }

    async get(plural: string, id: number): Promise<CellRecord | null> {
        const [table, key, , bools] = this.resource(plural);
        return this.out(this.db.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(Math.trunc(id)), key, bools);
    }

    async create(plural: string, fields: Record<string, unknown>): Promise<CellRecord> {
        const [table, key] = this.resource(plural);
        const columns = this.columns(table);
        const data: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(fields)) {
            if (columns.has(name) && value !== null && value !== undefined) data[name] = typeof value === "boolean" ? Number(value) : value;
        }
        if (fields.legacy_id !== undefined && fields.legacy_id !== null) data[key] = fields.legacy_id;
        let result;
        try {
            result = this.db.prepare(`INSERT INTO ${table} (${Object.keys(data).join(", ")}) VALUES (${Object.keys(data).map(() => "?").join(", ")})`)
                .run(...Object.values(data));
        } catch (error: any) {
            throw new CellStoreError(String(error?.message).includes("UNIQUE") ? 409 : 422, "conflict", this.cell);
        }
        return (await this.get(plural, Number(data[key] ?? result.lastInsertRowid)))!;
    }

    async update(plural: string, id: number, fields: Record<string, unknown>): Promise<CellRecord> {
        const [table, key] = this.resource(plural);
        if (!(await this.get(plural, id))) throw new CellStoreError(404, "not_found", this.cell);
        const columns = this.columns(table);
        const data = Object.entries(fields).filter(([name]) => columns.has(name) && name !== key)
            .map(([name, value]) => [name, typeof value === "boolean" ? Number(value) : value] as const);
        if (data.length) {
            const stamp = columns.has("updated_at") && !data.some(([name]) => name === "updated_at");
            this.db.prepare(`UPDATE ${table} SET ${data.map(([name]) => `${name} = ?`).join(", ")}${stamp ? ", updated_at = ?" : ""} WHERE ${key} = ?`)
                .run(...data.map(([, value]) => value), ...(stamp ? [new Date().toISOString()] : []), Math.trunc(id));
        }
        return (await this.get(plural, id))!;
    }

    async delete(plural: string, id: number): Promise<boolean> {
        const [table, key] = this.resource(plural);
        return this.db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(Math.trunc(id)).changes > 0;
    }

    async stats(plural: string, groupBy: string, filters: Filters = {}): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        for (const row of await this.list(plural, filters)) counts[String(row[groupBy])] = (counts[String(row[groupBy])] ?? 0) + 1;
        return counts;
    }
}

/** A factory for overrideCellStoreForTests: one double per cell over the same database. */
export function sqliteCellOpener(db: SqliteDb): (cell: string) => CellStore {
    const stores = new Map<string, SqliteCellStore>();
    return (cell) => {
        if (!stores.has(cell)) stores.set(cell, new SqliteCellStore(db, cell));
        return stores.get(cell)!;
    };
}
