import { initDb, closeDb } from "../db.js";

console.log("Initializing database...");
await initDb();
console.log("Database initialized successfully!");
closeDb();
