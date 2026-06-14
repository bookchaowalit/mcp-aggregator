import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../../database/solo-empire.db");
const SCHEMA_PATH = join(__dirname, "../../database/schema.sql");

let db: SqlJsDatabase | null = null;

// Wrapper to provide a better-sqlite3-like API
class DatabaseWrapper {
    private sqlDb: SqlJsDatabase;

    constructor(sqlDb: SqlJsDatabase) {
        this.sqlDb = sqlDb;
    }

    prepare(sql: string) {
        const self = this;
        return {
            run(...params: any[]) {
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
        this.sqlDb.exec(sql);
        this.save();
    }

    private save() {
        try {
            const data = this.sqlDb.export();
            const buffer = Buffer.from(data);
            writeFileSync(DB_PATH, buffer);
        } catch (e) {
            // Ignore save errors during read operations
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

    const SQL = await initSqlJs();

    if (existsSync(DB_PATH)) {
        const fileBuffer = readFileSync(DB_PATH);
        const sqlDb = new SQL.Database(fileBuffer);
        wrapper = new DatabaseWrapper(sqlDb);
    } else {
        const sqlDb = new SQL.Database();
        wrapper = new DatabaseWrapper(sqlDb);
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

    // Force save after init
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);

    console.error("Database initialized successfully");
}

export function closeDb(): void {
    if (wrapper) {
        wrapper.close();
        wrapper = null;
    }
}
