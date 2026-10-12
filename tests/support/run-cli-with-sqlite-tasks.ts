/**
 * Test-only CLI runner: injects the SQLite task double (SOLO_EMPIRE_DB_PATH) and
 * and the SQLite goals/projects/roles-skills cell doubles, then runs the ops-toolkit owner CLI (SOLO_OPS_CLI) unchanged. Usage: node tsx run-cli-with-sqlite-tasks.ts tasks <args>.
 */
import Database from "better-sqlite3";
import { overrideCellStoreForTests } from "../../src/cell-store.js";
import { overrideTaskStoreForTests } from "../../src/task-store.js";
import { sqliteCellOpener } from "./sqlite-cell-store.js";
import { SqliteTaskStore } from "./sqlite-task-store.js";

const db = new Database(process.env.SOLO_EMPIRE_DB_PATH as string);
overrideTaskStoreForTests(() => new SqliteTaskStore(db));
overrideCellStoreForTests(sqliteCellOpener(db)); // goals, projects and skills live in cells
await import(process.env.SOLO_OPS_CLI as string); // ops-toolkit owner CLI (infra/cli.ts)
