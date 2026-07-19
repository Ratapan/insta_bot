import Database from "better-sqlite3";
import fs from "node:fs";
const env = fs.readFileSync("./.env", "utf8");
const dbPath = (env.match(/^DATABASE_PATH=(.*)$/m)?.[1] ?? "./data/app.db").trim();
const db = new Database(dbPath, { readonly: true });
for (const t of ["user", "account", "instagram_account", "generation_log", "scheduled_post", "session"]) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t);
  console.log("\n=== " + t + " ===");
  console.log(row?.sql);
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?").all(t);
  for (const i of idx) console.log("  idx:", i.sql ?? i.name);
}
