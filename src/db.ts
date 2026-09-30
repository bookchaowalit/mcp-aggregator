import Database from "better-sqlite3";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname, resolve, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
// infra/mcp-server/src → repository root (not process.cwd())
const REPO_ROOT = resolve(__dirname, "../../..");
const DEFAULT_DB_REL = "infra/database/solo-empire.db";
const SCHEMA_PATH = join(REPO_ROOT, "infra/database/schema.sql");

/**
 * Resolve SOLO_EMPIRE_DB_PATH relative to the repository root.
 * Absolute paths are used as-is. Empty/unset → default under REPO_ROOT.
 *
 * DATABASE_PATH is accepted as a deprecated fallback for older tests/scripts.
 */
export function resolveDbPath(envValue?: string | null): string {
    const raw =
        envValue ??
        process.env.SOLO_EMPIRE_DB_PATH ??
        process.env.DATABASE_PATH ??
        "";
    if (!raw || !String(raw).trim()) {
        return join(REPO_ROOT, DEFAULT_DB_REL);
    }
    const trimmed = String(raw).trim();
    if (isAbsolute(trimmed)) {
        return trimmed;
    }
    return resolve(REPO_ROOT, trimmed);
}

export const DB_PATH = resolveDbPath();

let db: Database.Database | null = null;

/**
 * Open an existing database; creation requires explicit initialization.
 * Uses better-sqlite3 for native SQLite access with:
 * - WAL mode for concurrent reads
 * - Foreign keys enabled
 * - Native file-based storage (no in-memory sync issues)
 */
export function getDb(): Database.Database {
    return openDb(false);
}

function openDb(allowCreate: boolean): Database.Database {
    if (db) return db;

    const dbExists = existsSync(DB_PATH);
    if (!dbExists && !allowCreate) {
        throw new Error(`Database missing at ${DB_PATH}; run an explicit db:init or recovery. Refusing automatic empty-ledger creation.`);
    }

    // Create directory if it doesn't exist
    const dbDir = dirname(DB_PATH);
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }

    // Open database with WAL mode for better concurrency
    db = new Database(DB_PATH);

    // Enable WAL mode for concurrent read/write support
    db.pragma("journal_mode = WAL");

    // Enable foreign keys
    db.pragma("foreign_keys = ON");

    // Set busy timeout to handle lock contention gracefully
    db.pragma("busy_timeout = 5000");

    if (!dbExists) {
        // New database - will be initialized by initDb()
        console.error("[DB] Created new database file at:", DB_PATH);
    } else {
        console.error("[DB] Opened existing database at:", DB_PATH);
    }

    return db;
}

/**
 * Initialize the database from schema.sql.
 * Creates tables if they don't exist.
 */
export function initDb(): void {
    if (!existsSync(DB_PATH)) guardBootstrap();
    const database = openDb(true);
    const schema = readFileSync(SCHEMA_PATH, "utf-8");

    // Only apply the bootstrap schema to a new or empty database. Replaying
    // plain CREATE TABLE statements against the live database is not safe.
    const tableCount = database
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'")
        .get() as { count: number };
    if (tableCount.count === 0) {
        guardBootstrap();
        // Execute schema SQL - better-sqlite3 handles multiple statements natively
        database.exec(schema);
        console.error("Database initialized successfully");
    } else {
        console.error(`Database already initialized (${tableCount.count} tables)`);
    }
}

function guardBootstrap(): void {
    const python = process.env.SOLO_EMPIRE_PYTHON3 || (process.platform === "win32" ? "python" : "python3");
    const result = spawnSync(
        python,
        [join(REPO_ROOT, "infra", "scripts", "db", "finance_safety.py"), "--bootstrap", "--db-path", DB_PATH],
        { encoding: "utf-8", timeout: 30_000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
    if (result.error || result.status !== 0) {
        throw new Error(result.error?.message || result.stderr.trim() || "Database bootstrap guard failed");
    }
    if (result.stdout.trim()) console.error(result.stdout.trim());
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
        console.error("[DB] Database connection closed");
    }
}

/**
 * Helper: Run a migration SQL file safely.
 * Uses native exec() which handles multiple statements correctly.
 */
export function runMigration(sql: string): void {
    const database = getDb();

    // better-sqlite3's exec() handles multiple statements natively
    // No need for manual semicolon splitting
    database.exec(sql);
}
