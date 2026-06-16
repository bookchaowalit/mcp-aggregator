import Database from "better-sqlite3";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Allow overriding DB path via environment variable (useful for tests)
const DB_PATH = process.env.DATABASE_PATH || join(__dirname, "../../database/solo-empire.db");
const SCHEMA_PATH = join(__dirname, "../../database/schema.sql");

let db: Database.Database | null = null;

/**
 * Get or create the database connection.
 * Uses better-sqlite3 for native SQLite access with:
 * - WAL mode for concurrent reads
 * - Foreign keys enabled
 * - Native file-based storage (no in-memory sync issues)
 */
export function getDb(): Database.Database {
    if (db) return db;

    const dbExists = existsSync(DB_PATH);
    
    // Create directory if it doesn't exist
    const dbDir = dirname(DB_PATH);
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }

    // Open database with WAL mode for better concurrency
    db = new Database(DB_PATH);
    
    // Enable WAL mode for concurrent read/write support
    db.pragma('journal_mode = WAL');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    
    // Set busy timeout to handle lock contention gracefully
    db.pragma('busy_timeout = 5000');

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
    const database = getDb();
    const schema = readFileSync(SCHEMA_PATH, "utf-8");

    // Execute schema SQL - better-sqlite3 handles multiple statements natively
    database.exec(schema);

    console.error("Database initialized successfully");
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
