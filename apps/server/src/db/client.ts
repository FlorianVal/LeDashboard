import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MetricKey } from "@ledashboard/shared";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DbContext = {
  sqlite: Database.Database;
  db: AppDatabase;
};

type MetricDefinition = {
  key: MetricKey;
  sourceId: string;
  displayName: string;
  unit: string;
  kind: string;
  staleAfterSeconds: number;
};

const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  { key: "comfort.indoor_temperature", sourceId: "home-assistant", displayName: "Indoor temperature", unit: "°C", kind: "gauge", staleAfterSeconds: 900 },
  { key: "comfort.outdoor_temperature", sourceId: "home-assistant", displayName: "Outdoor temperature", unit: "°C", kind: "gauge", staleAfterSeconds: 900 },
  { key: "comfort.climate_target", sourceId: "home-assistant", displayName: "Climate target", unit: "°C", kind: "gauge", staleAfterSeconds: 900 },
  { key: "weather.humidity", sourceId: "home-assistant", displayName: "Humidity", unit: "%", kind: "gauge", staleAfterSeconds: 900 },
  { key: "weather.pressure", sourceId: "home-assistant", displayName: "Pressure", unit: "hPa", kind: "gauge", staleAfterSeconds: 900 },
  { key: "weather.wind_speed", sourceId: "home-assistant", displayName: "Wind speed", unit: "km/h", kind: "gauge", staleAfterSeconds: 900 },
  { key: "plants.overdue_count", sourceId: "laplante", displayName: "Overdue plants", unit: "plants", kind: "gauge", staleAfterSeconds: 7200 },
  { key: "timelapse.library_bytes", sourceId: "letimelapse", displayName: "Timelapse library", unit: "bytes", kind: "gauge", staleAfterSeconds: 900 },
  { key: "mac.cpu_percent", sourceId: "mac", displayName: "Mac CPU", unit: "%", kind: "gauge", staleAfterSeconds: 180 },
  { key: "mac.memory_percent", sourceId: "mac", displayName: "Mac memory", unit: "%", kind: "gauge", staleAfterSeconds: 180 },
  { key: "mac.disk_percent", sourceId: "mac", displayName: "Mac disk", unit: "%", kind: "gauge", staleAfterSeconds: 180 },
  { key: "mac.network_receive_bps", sourceId: "mac", displayName: "Mac network receive", unit: "B/s", kind: "gauge", staleAfterSeconds: 180 },
  { key: "mac.network_transmit_bps", sourceId: "mac", displayName: "Mac network transmit", unit: "B/s", kind: "gauge", staleAfterSeconds: 180 },
  { key: "nas.storage_used_bytes", sourceId: "nas", displayName: "NAS storage used", unit: "bytes", kind: "gauge", staleAfterSeconds: 900 },
  { key: "nas.storage_total_bytes", sourceId: "nas", displayName: "NAS storage total", unit: "bytes", kind: "gauge", staleAfterSeconds: 900 },
  { key: "services.available_percent", sourceId: "availability", displayName: "Services available", unit: "%", kind: "gauge", staleAfterSeconds: 180 },
];

function registerMetricDefinitions(sqlite: Database.Database): void {
  if (METRIC_DEFINITIONS.length !== 16) {
    throw new Error("Metric definitions do not match the curated metric catalogue");
  }

  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO metric_definitions
      (key, source_id, display_name, unit, kind, stale_after_seconds)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const registerAll = sqlite.transaction(() => {
    for (const definition of METRIC_DEFINITIONS) {
      insert.run(
        definition.key,
        definition.sourceId,
        definition.displayName,
        definition.unit,
        definition.kind,
        definition.staleAfterSeconds,
      );
    }
  });
  registerAll();
}

export function createDatabase(path: string): DbContext {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS metric_definitions (
      key TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      kind TEXT NOT NULL,
      stale_after_seconds INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS samples_raw (
      metric_key TEXT NOT NULL REFERENCES metric_definitions(key),
      ts INTEGER NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (metric_key, ts)
    );
    CREATE TABLE IF NOT EXISTS samples_rollup (
      metric_key TEXT NOT NULL REFERENCES metric_definitions(key),
      bucket_seconds INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      avg REAL NOT NULL,
      min REAL NOT NULL,
      max REAL NOT NULL,
      PRIMARY KEY (metric_key, bucket_seconds, ts)
    );
    CREATE TABLE IF NOT EXISTS current_values (
      key TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      numeric_value REAL,
      text_value TEXT
    );
    CREATE TABLE IF NOT EXISTS source_state (
      source_id TEXT PRIMARY KEY,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS service_state (
      service_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      latency_ms REAL,
      consecutive_failures INTEGER NOT NULL,
      consecutive_successes INTEGER NOT NULL,
      active_incident_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_error TEXT
    );
  `);

  registerMetricDefinitions(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
