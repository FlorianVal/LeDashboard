import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DbContext = {
  sqlite: Database.Database;
  db: AppDatabase;
};

export function createDatabase(path: string): DbContext {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS metric_definitions (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT,
      labels_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS samples (
      id TEXT PRIMARY KEY,
      metric_id TEXT NOT NULL REFERENCES metric_definitions(id) ON DELETE CASCADE,
      ts INTEGER NOT NULL,
      value REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS samples_metric_ts_idx ON samples(metric_id, ts);
    CREATE INDEX IF NOT EXISTS samples_ts_idx ON samples(ts);
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
