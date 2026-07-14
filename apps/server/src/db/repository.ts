import type { CurrentValue, CurrentValueKey, MetricKey, Sample } from "@ledashboard/shared";
import type Database from "better-sqlite3";

export type MetricSampleInput = {
  key: MetricKey;
  ts: number;
  value: number;
};

export type CurrentValueInput = {
  key: CurrentValueKey;
  ts: number;
  numericValue?: number;
  textValue?: string;
};

export type SeriesResolution = "raw" | "5m" | "1h";

type CurrentValueRow = {
  key: CurrentValueKey;
  ts: number;
  numeric_value: number | null;
  text_value: string | null;
};

export class MetricsRepository {
  constructor(private readonly sqlite: Database.Database) {}

  insertSamples(samples: readonly MetricSampleInput[]): void {
    const insert = this.sqlite.prepare(`
      INSERT OR IGNORE INTO samples_raw (metric_key, ts, value)
      VALUES (?, ?, ?)
    `);
    const insertAll = this.sqlite.transaction((items: readonly MetricSampleInput[]) => {
      for (const sample of items) {
        insert.run(sample.key, sample.ts, sample.value);
      }
    });
    insertAll(samples);
  }

  setCurrentValues(values: readonly CurrentValueInput[]): void {
    const upsert = this.sqlite.prepare(`
      INSERT INTO current_values (key, ts, numeric_value, text_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        ts = excluded.ts,
        numeric_value = excluded.numeric_value,
        text_value = excluded.text_value
    `);
    const setAll = this.sqlite.transaction((items: readonly CurrentValueInput[]) => {
      for (const value of items) {
        upsert.run(
          value.key,
          value.ts,
          value.numericValue ?? null,
          value.textValue ?? null,
        );
      }
    });
    setAll(values);
  }

  getSeries(
    key: MetricKey,
    from: number,
    to: number,
    resolution: SeriesResolution,
  ): Sample[] {
    if (resolution === "raw") {
      const rows = this.sqlite.prepare(`
        SELECT ts, value AS avg, value AS min, value AS max
        FROM samples_raw
        WHERE metric_key = ? AND ts >= ? AND ts <= ?
        ORDER BY ts ASC
      `).all(key, from, to) as Sample[];
      return rows;
    }

    const bucketSeconds = resolution === "5m" ? 300 : 3600;
    const rows = this.sqlite.prepare(`
      SELECT ts, avg, min, max
      FROM samples_rollup
      WHERE metric_key = ?
        AND bucket_seconds = ?
        AND ts >= ?
        AND ts <= ?
      ORDER BY ts ASC
    `).all(key, bucketSeconds, from, to) as Sample[];
    return rows;
  }

  getLatestSample(key: MetricKey, to: number): Sample | null {
    const row = this.sqlite.prepare(`
      SELECT ts, avg, min, max
      FROM (
        SELECT ts, value AS avg, value AS min, value AS max, 3 AS priority
        FROM samples_raw
        WHERE metric_key = ? AND ts <= ?
        UNION ALL
        SELECT ts, avg, min, max,
          CASE bucket_seconds WHEN 300 THEN 2 ELSE 1 END AS priority
        FROM samples_rollup
        WHERE metric_key = ? AND ts <= ?
      )
      ORDER BY ts DESC, priority DESC
      LIMIT 1
    `).get(key, to, key, to) as Sample | undefined;
    return row ?? null;
  }

  getCurrentValue(key: CurrentValueKey): CurrentValue | null {
    const row = this.sqlite.prepare(`
      SELECT key, ts, numeric_value, text_value
      FROM current_values
      WHERE key = ?
    `).get(key) as CurrentValueRow | undefined;

    return row
      ? {
          key: row.key,
          ts: row.ts,
          numericValue: row.numeric_value,
          textValue: row.text_value,
        }
      : null;
  }
}
