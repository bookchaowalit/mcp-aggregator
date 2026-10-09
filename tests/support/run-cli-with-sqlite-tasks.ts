/**
 * Test-only CLI runner: injects the SQLite task double (SOLO_EMPIRE_DB_PATH) and
 * then runs infra/cli.ts unchanged. Usage: node tsx run-cli-with-sqlite-tasks.ts tasks <args>.
 */
import Database from "better-sqlite3";
import { overrideTaskStoreForTests } from "../../src/task-store.js";
import { SqliteTaskStore } from "./sqlite-task-store.js";

const db = new Database(process.env.SOLO_EMPIRE_DB_PATH as string);
overrideTaskStoreForTests(() => new SqliteTaskStore(db));
await import("../../../cli.js");
