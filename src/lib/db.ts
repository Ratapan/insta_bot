import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../db/schema";

const dbPath = resolve(import.meta.env.DATABASE_PATH ?? "./data/app.db");
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

// Aplica las migraciones pendientes al arrancar (dev y Railway).
migrate(db, { migrationsFolder: resolve("./src/db/migrations") });
