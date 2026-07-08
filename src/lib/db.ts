import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
// Las migraciones son .sql que Vite no incluye en el bundle: en dev viven
// junto al código fuente; en producción (dist/) dependemos de que el deploy
// incluya src/ y el cwd sea la raíz del repo. Probamos ambas rutas y fallamos
// con un error claro (mejor que un ENOENT opaco) si ninguna existe.
const migrationCandidates = [
  fileURLToPath(new URL("../db/migrations", import.meta.url)),
  resolve("./src/db/migrations"),
];
const migrationsFolder = migrationCandidates.find((p) => existsSync(p));
if (!migrationsFolder) {
  throw new Error(
    `No se encontró la carpeta de migraciones. Rutas probadas:\n${migrationCandidates.join("\n")}`,
  );
}
migrate(db, { migrationsFolder });
