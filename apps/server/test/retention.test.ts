import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "../src/db/client.js";
import { MetricsRepository } from "../src/db/repository.js";
import { resolutionForRange, runRetention } from "../src/services/retention.js";

const DAY = 86_400;

const databases: Array<{ directory: string; sqlite: AppDatabase }> = [];

function temporaryDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-retention-"));
  const { sqlite } = createDatabase(join(directory, "ledashboard-v2.sqlite"));
  databases.push({ directory, sqlite });
  return sqlite;
}

function seedRawSamples(
  sqlite: AppDatabase,
  key: "mac.cpu_percent",
  ts: number,
  value: number,
): void {
  new MetricsRepository(sqlite).insertSamples([{ key, ts, value }]);
}

function countRawBefore(sqlite: AppDatabase, cutoff: number): number {
  return (sqlite.prepare("SELECT COUNT(*) AS count FROM samples_raw WHERE ts < ?")
    .get(cutoff) as { count: number }).count;
}

function countRollups(sqlite: AppDatabase, bucketSeconds: number): number {
  return (sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM samples_rollup
    WHERE bucket_seconds = ?
  `).get(bucketSeconds) as { count: number }).count;
}

afterEach(() => {
  for (const { directory, sqlite } of databases.splice(0)) {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("metrics retention", () => {
  it("rolls up before pruning each tier", () => {
    const sqlite = temporaryDatabase();
    const now = 20_000_000;
    seedRawSamples(sqlite, "mac.cpu_percent", now - 8 * DAY, 12);

    runRetention(sqlite, now);

    expect(countRawBefore(sqlite, now - 7 * DAY)).toBe(0);
    expect(countRollups(sqlite, 300)).toBeGreaterThan(0);
    expect(countRollups(sqlite, 3600)).toBeGreaterThan(0);
  });

  it("removes rows one second before each cutoff and keeps rows at and after it", () => {
    const sqlite = temporaryDatabase();
    const now = 20_001_600;
    const insertRaw = sqlite.prepare(`
      INSERT INTO samples_raw (metric_key, ts, value) VALUES (?, ?, ?)
    `);
    const insertRollup = sqlite.prepare(`
      INSERT INTO samples_rollup (metric_key, bucket_seconds, ts, avg, min, max)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertIncident = sqlite.prepare(`
      INSERT INTO incidents (service_id, started_at, ended_at, last_error)
      VALUES (?, ?, ?, ?)
    `);

    insertRaw.run("mac.cpu_percent", now - 7 * DAY, 10);
    insertRaw.run("mac.cpu_percent", now - 7 * DAY - 1, 20);
    insertRaw.run("mac.cpu_percent", now - 7 * DAY + 1, 30);
    insertRollup.run("mac.cpu_percent", 300, now - 30 * DAY, 10, 10, 10);
    insertRollup.run("mac.cpu_percent", 300, now - 30 * DAY - 1, 20, 20, 20);
    insertRollup.run("mac.cpu_percent", 300, now - 30 * DAY + 1, 30, 30, 30);
    insertRollup.run("mac.cpu_percent", 3600, now - 180 * DAY, 10, 10, 10);
    insertRollup.run("mac.cpu_percent", 3600, now - 180 * DAY - 1, 20, 20, 20);
    insertRollup.run("mac.cpu_percent", 3600, now - 180 * DAY + 1, 30, 30, 30);
    insertIncident.run(
      "boundary",
      new Date((now - 181 * DAY) * 1000).toISOString(),
      new Date((now - 180 * DAY) * 1000).toISOString(),
      null,
    );
    insertIncident.run(
      "expired",
      new Date((now - 181 * DAY) * 1000).toISOString(),
      new Date((now - 180 * DAY - 1) * 1000).toISOString(),
      null,
    );
    insertIncident.run(
      "recent",
      new Date((now - 181 * DAY) * 1000).toISOString(),
      new Date((now - 180 * DAY + 1) * 1000).toISOString(),
      null,
    );
    insertIncident.run(
      "active",
      new Date((now - 181 * DAY) * 1000).toISOString(),
      null,
      null,
    );

    runRetention(sqlite, now);

    expect(sqlite.prepare("SELECT ts FROM samples_raw ORDER BY ts").all())
      .toEqual([{ ts: now - 7 * DAY }, { ts: now - 7 * DAY + 1 }]);
    expect(sqlite.prepare(`
      SELECT bucket_seconds, ts
      FROM samples_rollup
      WHERE ts IN (?, ?, ?, ?, ?, ?)
      ORDER BY bucket_seconds, ts
    `).all(
      now - 30 * DAY - 1,
      now - 30 * DAY,
      now - 30 * DAY + 1,
      now - 180 * DAY - 1,
      now - 180 * DAY,
      now - 180 * DAY + 1,
    )).toEqual([
      { bucket_seconds: 300, ts: now - 30 * DAY },
      { bucket_seconds: 300, ts: now - 30 * DAY + 1 },
      { bucket_seconds: 3600, ts: now - 180 * DAY },
      { bucket_seconds: 3600, ts: now - 180 * DAY + 1 },
    ]);
    expect(sqlite.prepare("SELECT service_id FROM incidents ORDER BY service_id").all())
      .toEqual([
        { service_id: "active" },
        { service_id: "boundary" },
        { service_id: "recent" },
      ]);
  });

  it("is idempotent and preserves aggregate statistics", () => {
    const sqlite = temporaryDatabase();
    const now = 20_001_600;
    seedRawSamples(sqlite, "mac.cpu_percent", now - 6 * DAY, 10);
    seedRawSamples(sqlite, "mac.cpu_percent", now - 6 * DAY + 60, 20);
    seedRawSamples(sqlite, "mac.cpu_percent", now - 6 * DAY + 120, 30);

    runRetention(sqlite, now);
    const afterFirstRun = sqlite.prepare(`
      SELECT bucket_seconds, ts, avg, min, max
      FROM samples_rollup
      ORDER BY bucket_seconds, ts
    `).all();
    runRetention(sqlite, now);
    const afterSecondRun = sqlite.prepare(`
      SELECT bucket_seconds, ts, avg, min, max
      FROM samples_rollup
      ORDER BY bucket_seconds, ts
    `).all();

    expect(afterFirstRun).toEqual([
      { bucket_seconds: 300, ts: now - 6 * DAY, avg: 20, min: 10, max: 30 },
      { bucket_seconds: 3600, ts: now - 6 * DAY, avg: 20, min: 10, max: 30 },
    ]);
    expect(afterSecondRun).toEqual(afterFirstRun);
  });

  it("selects raw, five-minute, and hourly resolution", () => {
    expect(resolutionForRange(2 * DAY)).toBe("raw");
    expect(resolutionForRange(20 * DAY)).toBe("5m");
    expect(resolutionForRange(180 * DAY)).toBe("1h");
  });

  it("switches resolution only after each exact boundary", () => {
    expect(resolutionForRange(7 * DAY)).toBe("raw");
    expect(resolutionForRange(7 * DAY + 1)).toBe("5m");
    expect(resolutionForRange(30 * DAY)).toBe("5m");
    expect(resolutionForRange(30 * DAY + 1)).toBe("1h");
  });
});
