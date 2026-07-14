import { unixTimestamp } from "@ledashboard/shared";
import type { AppDatabase, DbContext } from "../db/client.js";
import type { SeriesResolution } from "../db/repository.js";

const DAY = 86_400;
const RAW_RETENTION_SECONDS = 7 * DAY;
const FIVE_MINUTE_RETENTION_SECONDS = 30 * DAY;
const HOURLY_RETENTION_SECONDS = 180 * DAY;

function rollUpRawSamples(
  sqlite: AppDatabase,
  bucketSeconds: 300 | 3600,
  rawCutoff: number,
): void {
  sqlite.prepare(`
    INSERT INTO samples_rollup(metric_key, bucket_seconds, ts, avg, min, max)
    SELECT metric_key, ${bucketSeconds},
      (ts / ${bucketSeconds}) * ${bucketSeconds},
      AVG(value), MIN(value), MAX(value)
    FROM samples_raw
    GROUP BY metric_key, (ts / ${bucketSeconds}) * ${bucketSeconds}
    ON CONFLICT(metric_key, bucket_seconds, ts) DO UPDATE SET
      avg = excluded.avg, min = excluded.min, max = excluded.max
    WHERE excluded.ts >= ?
  `).run(rawCutoff);
}

export function resolutionForRange(rangeSeconds: number): SeriesResolution {
  if (rangeSeconds <= RAW_RETENTION_SECONDS) {
    return "raw";
  }
  if (rangeSeconds <= FIVE_MINUTE_RETENTION_SECONDS) {
    return "5m";
  }
  return "1h";
}

export function runRetention(sqlite: AppDatabase, nowSeconds: number): void {
  const rawCutoff = nowSeconds - RAW_RETENTION_SECONDS;
  const retainAndPrune = sqlite.transaction(() => {
    rollUpRawSamples(sqlite, 300, rawCutoff);
    rollUpRawSamples(sqlite, 3600, rawCutoff);

    sqlite.prepare("DELETE FROM samples_raw WHERE ts < ?")
      .run(rawCutoff);
    sqlite.prepare(`
      DELETE FROM samples_rollup
      WHERE bucket_seconds = 300 AND ts < ?
    `).run(nowSeconds - FIVE_MINUTE_RETENTION_SECONDS);
    sqlite.prepare(`
      DELETE FROM samples_rollup
      WHERE bucket_seconds = 3600 AND ts < ?
    `).run(nowSeconds - HOURLY_RETENTION_SECONDS);
    sqlite.prepare(`
      DELETE FROM incidents
      WHERE ended_at IS NOT NULL AND ended_at < ?
    `).run(new Date((nowSeconds - HOURLY_RETENTION_SECONDS) * 1000).toISOString());
  });

  retainAndPrune();
}

export function pruneOldSamples(db: DbContext): void {
  runRetention(db.sqlite, unixTimestamp());
}
