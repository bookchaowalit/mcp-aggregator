/**
 * Helpers for the TypeScript runtimes that used to combine goal, project and skill rows in SQLite. Those rows
 * now live in the goals, projects and roles-skills cells (see cell-store.ts), which only filter on equality,
 * so ordering, joining and aggregating happen here. Datasets are small (<400 rows per table).
 */
import type { CellRecord } from "./cell-store.js";

export type Row = Record<string, any>;
export type SortKey = [field: string, direction?: "asc" | "desc"];

/** SQLite ordering: NULL sorts before any value when ascending. */
function compareField(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a) < String(b) ? -1 : 1;
}

/** Stable multi-key sort equivalent to `ORDER BY k1 [DESC], k2 ...`; returns a new array. */
export function sortRows<T extends Row>(rows: T[], ...keys: SortKey[]): T[] {
    return [...rows].sort((left, right) => {
        for (const [field, direction = "asc"] of keys) {
            const result = compareField(left[field], right[field]);
            if (result !== 0) return direction === "desc" ? -result : result;
        }
        return 0;
    });
}

export function indexById<T extends Row>(rows: T[]): Map<number, T> {
    return new Map(rows.map((row) => [Number(row.id), row]));
}

/** The old count, average progress_percent and summed hours_invested over every skill row. */
export function skillStats(skills: Row[]): { total: number; avg_progress: number | null; total_hours: number | null } {
    const progress = skills.map((s) => s.progress_percent).filter((v) => v !== null && v !== undefined).map(Number);
    const hours = skills.map((s) => s.hours_invested).filter((v) => v !== null && v !== undefined).map(Number);
    return {
        total: skills.length,
        avg_progress: progress.length ? progress.reduce((a, b) => a + b, 0) / progress.length : null,
        total_hours: hours.length ? hours.reduce((a, b) => a + b, 0) : null,
    };
}

/** Each skill row with its category's name, slug, icon and color attached (the old left join on category_id). */
export function withCategory(skills: CellRecord[], categories: CellRecord[]): Row[] {
    const byId = indexById(categories);
    return skills.map((skill) => {
        const category = skill.category_id == null ? undefined : byId.get(Number(skill.category_id));
        return { ...skill, category_name: category?.name ?? null, category_slug: category?.slug ?? null,
                 category_icon: category?.icon ?? null, category_color: category?.color ?? null };
    });
}
