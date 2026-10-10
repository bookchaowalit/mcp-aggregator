/**
 * Test-only launcher: injects the SQLite task and cell doubles (SOLO_EMPIRE_DB_PATH) and then runs
 * infra/dashboard/server.ts unchanged. Usage: node --import tsx run-dashboard-with-sqlite-stores.ts.
 */
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { overrideCellStoreForTests } from "../../src/cell-store.js";
import { overrideTaskStoreForTests } from "../../src/task-store.js";
import { sqliteCellOpener } from "./sqlite-cell-store.js";
import { SqliteTaskStore } from "./sqlite-task-store.js";

const db = new Database(process.env.SOLO_EMPIRE_DB_PATH as string);
overrideTaskStoreForTests(() => new SqliteTaskStore(db));
overrideCellStoreForTests(sqliteCellOpener(db));
// server.ts only binds its port when it is the entry module.
const server = fileURLToPath(new URL("../../../dashboard/server.ts", import.meta.url));
process.argv[1] = server;
await import(server);
