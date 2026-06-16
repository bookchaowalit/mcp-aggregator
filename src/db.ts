import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, openSync, closeSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Allow overriding DB path via environment variable (useful for tests)
const DB_PATH = process.env.DATABASE_PATH || join(__dirname, "../../database/solo-empire.db");
const SCHEMA_PATH = join(__dirname, "../../database/schema.sql");
const LOCK_PATH = `${DB_PATH}.lock`;
const LOCK_TIMEOUT_MS = 5000; // 5 seconds
const LOCK_RETRY_MS = 50; // 50ms between retries

let db: SqlJsDatabase | null = null;

/**
 * Acquire an exclusive file lock to prevent concurrent DB writes.
 * This is critical because sql.js keeps the entire DB in memory,
 * and concurrent saves can overwrite each other's changes.
 * @throws Error if lock cannot be acquired within timeout
 */
function acquireLock(): void {
    const start = Date.now();
    while (true) {
        try {
            // wx = exclusive create, fails if file exists
            const fd = openSync(LOCK_PATH, "wx");
            closeSync(fd);
            return; // Lock acquired
        } catch (e: any) {
            if (e.code !== "EEXIST") throw e; // Unexpected error
            
            // Lock held by another process
            if (Date.now() - start > LOCK_TIMEOUT_MS) {
                throw new Error(`[DB] Lock timeout: another process is holding the DB lock after ${LOCK_TIMEOUT_MS}ms`);
            }
            
            // Wait and retry
            const elapsed = Date.now() - start;
            const sleepMs = Math.min(LOCK_RETRY_MS, LOCK_TIMEOUT_MS - elapsed);
            if (sleepMs > 0) {
                // Synchronous sleep using Atomics.wait (Node.js 14+)
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
            }
        }
    }
}

/**
 * Release the file lock.
 */
function releaseLock(): void {
    try {
        unlinkSync(LOCK_PATH);
    } catch (e: any) {
        if (e.code !== "ENOENT") {
            console.error(`[DB] Warning: Failed to release lock: ${e}`);
        }
    }
}

// Wrapper to provide a better-sqlite3-like API
class DatabaseWrapper {
    private sqlDb: SqlJsDatabase;
    private SQL: any; // Reference to sql.js constructor for refreshing

    constructor(sqlDb: SqlJsDatabase, SQL: any) {
        this.sqlDb = sqlDb;
        this.SQL = SQL;
    }

    /**
     * Refresh the in-memory DB from disk to get latest changes from other processes.
     * This is called before each write to minimize the "lost update" problem.
     */
    private refresh(): void {
        if (!existsSync(DB_PATH)) return;
        
        try {
            const diskBuffer = readFileSync(DB_PATH);
            const freshDb = new this.SQL.Database(diskBuffer);
            
            // Export the fresh DB and re-import it into our in-memory DB
            // This is a workaround since sql.js doesn't have a "replace" method
            const freshData = freshDb.export();
            freshDb.close();
            
            // Close current DB and create a new one with fresh data
            this.sqlDb.close();
            this.sqlDb = new this.SQL.Database(freshData);
        } catch (e) {
            console.error(`[DB] Warning: Failed to refresh from disk: ${e}`);
            // Continue with current in-memory state
        }
    }

    prepare(sql: string) {
        const self = this;
        return {
            run(...params: any[]) {
                // Refresh from disk before write to get latest state
                self.refresh();
                self.sqlDb.run(sql, params);
                self.save();
                const lastId =
                    (self.sqlDb.exec("SELECT last_insert_rowid() as id")[0]
                        ?.values[0][0] as number) || 0;
                const changes = self.sqlDb.getRowsModified();
                return { lastInsertRowid: lastId, changes };
            },
            get(...params: any[]) {
                const stmt = self.sqlDb.prepare(sql);
                if (params.length > 0) stmt.bind(params);
                if (stmt.step()) {
                    const cols = stmt.getColumnNames();
                    const vals = stmt.get();
                    stmt.free();
                    const row: any = {};
                    cols.forEach((col, i) => (row[col] = vals[i]));
                    return row;
                }
                stmt.free();
                return undefined;
            },
            all(...params: any[]) {
                const results: any[] = [];
                const stmt = self.sqlDb.prepare(sql);
                if (params.length > 0) stmt.bind(params);
                while (stmt.step()) {
                    const cols = stmt.getColumnNames();
                    const vals = stmt.get();
                    const row: any = {};
                    cols.forEach((col, i) => (row[col] = vals[i]));
                    results.push(row);
                }
                stmt.free();
                return results;
            },
        };
    }

    exec(sql: string) {
        // Refresh from disk before write to get latest state
        this.refresh();
        this.sqlDb.exec(sql);
        this.save();
    }

    /**
     * Save the database to disk using atomic write (write-to-temp + rename).
     * This prevents corruption if the process crashes mid-write.
     * Uses a file lock to prevent concurrent writes from different processes.
     * Errors are logged and re-thrown, never silently swallowed.
     */
    private save() {
        // Export current in-memory state
        const currentData = this.sqlDb.export();
        const currentBuffer = Buffer.from(currentData);
        
        acquireLock();
        try {
            const tmpPath = `${DB_PATH}.${randomUUID()}.tmp`;
            
            // Step 1: Write to a temporary file
            writeFileSync(tmpPath, currentBuffer);
            
            // Step 2: Atomically rename temp to target (atomic on same filesystem)
            renameSync(tmpPath, DB_PATH);
        } catch (e) {
            console.error(`[DB] CRITICAL: Failed to save database: ${e}`);
            throw e;
        } finally {
            releaseLock();
        }
    }

    close() {
        this.save();
        this.sqlDb.close();
    }

    transaction(fn: (...args: any[]) => void) {
        const self = this;
        return (...args: any[]) => {
            self.sqlDb.run("BEGIN TRANSACTION");
            try {
                fn(...args);
                self.sqlDb.run("COMMIT");
                self.save();
            } catch (e) {
                self.sqlDb.run("ROLLBACK");
                throw e;
            }
        };
    }
}

let wrapper: DatabaseWrapper | null = null;

export async function getDb(): Promise<DatabaseWrapper> {
    if (wrapper) return wrapper;

    // Clean up stale lock file from previous crashed process
    if (existsSync(LOCK_PATH)) {
        try {
            unlinkSync(LOCK_PATH);
            console.error("[DB] Cleaned up stale lock file from previous process");
        } catch (e) {
            console.error(`[DB] Warning: Could not clean up stale lock file: ${e}`);
        }
    }

    const SQL = await initSqlJs();

    if (existsSync(DB_PATH)) {
        const fileBuffer = readFileSync(DB_PATH);
        const sqlDb = new SQL.Database(fileBuffer);
        wrapper = new DatabaseWrapper(sqlDb, SQL);
    } else {
        const sqlDb = new SQL.Database();
        wrapper = new DatabaseWrapper(sqlDb, SQL);
    }

    return wrapper;
}

export async function initDb(): Promise<void> {
    const database = await getDb();
    const schema = readFileSync(SCHEMA_PATH, "utf-8");

    // Split by semicolons and execute each statement
    // sql.js exec can handle multiple statements
    const sqlDb = (database as any).sqlDb as SqlJsDatabase;
    sqlDb.exec(schema);

    // Force save after init using atomic write
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    const tmpPath = `${DB_PATH}.${randomUUID()}.tmp`;
    try {
        writeFileSync(tmpPath, buffer);
        renameSync(tmpPath, DB_PATH);
    } catch (e) {
        try { unlinkSync(tmpPath); } catch {}
        console.error(`[DB] CRITICAL: Failed to save database after init: ${e}`);
        throw e;
    }

    console.error("Database initialized successfully");
}

export function closeDb(): void {
    if (wrapper) {
        wrapper.close();
        wrapper = null;
    }
}
