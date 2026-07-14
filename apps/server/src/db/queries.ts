import type { CategoryInfo, MetricDef, Sample } from "@ledashboard/shared";
import type { DbContext } from "./client.js";

type MetricDefinitionRow = {
  key: string;
  source_id: string;
  display_name: string;
  unit: string;
};

function toLegacyMetricDef(row: MetricDefinitionRow): MetricDef {
  return {
    id: row.key,
    sourceId: row.source_id,
    name: row.key,
    displayName: row.display_name,
    category: row.key.split(".", 1)[0],
    unit: row.unit,
    labels: {},
  };
}

export function insertMetricDef(
  ctx: DbContext,
  metric: Omit<MetricDef, "labels"> & { labelsJson?: string | null },
): void {
  ctx.sqlite.prepare(`
    UPDATE metric_definitions
    SET source_id = ?, display_name = ?, unit = COALESCE(?, unit)
    WHERE key = ?
  `).run(metric.sourceId, metric.displayName, metric.unit, metric.id);
}

export function insertSamplesBatch(
  ctx: DbContext,
  items: { metricId: string; ts: number; value: number }[],
): void {
  if (items.length === 0) return;
  const insert = ctx.sqlite.prepare(`
    INSERT OR IGNORE INTO samples_raw (metric_key, ts, value)
    SELECT ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM metric_definitions WHERE key = ?)
  `);
  const insertAll = ctx.sqlite.transaction(
    (rows: { metricId: string; ts: number; value: number }[]) => {
      for (const row of rows) {
        insert.run(row.metricId, row.ts, row.value, row.metricId);
      }
    },
  );
  insertAll(items);
}

export function getMetricDefinitions(ctx: DbContext): MetricDef[] {
  const rows = ctx.sqlite.prepare(`
    SELECT key, source_id, display_name, unit
    FROM metric_definitions
    ORDER BY key
  `).all() as MetricDefinitionRow[];
  return rows.map(toLegacyMetricDef);
}

export function getMetricDefinition(
  ctx: DbContext,
  id: string,
): MetricDef | null {
  const row = ctx.sqlite.prepare(`
    SELECT key, source_id, display_name, unit
    FROM metric_definitions
    WHERE key = ?
  `).get(id) as MetricDefinitionRow | undefined;
  return row ? toLegacyMetricDef(row) : null;
}

export function getSamples(
  ctx: DbContext,
  metricId: string,
  fromTs: number,
  toTs: number,
  windowSeconds?: number,
): Sample[] {
  if (windowSeconds && windowSeconds > 0) {
    const bucket = Math.floor(windowSeconds);
    const rows = ctx.sqlite.prepare(`
      SELECT (ts / ?) * ? AS bucket_ts,
             AVG(value) AS avg_val,
             MIN(value) AS min_val,
             MAX(value) AS max_val
      FROM samples_raw
      WHERE metric_key = ? AND ts >= ? AND ts <= ?
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
    `).all(bucket, bucket, metricId, fromTs, toTs) as {
      bucket_ts: number;
      avg_val: number;
      min_val: number;
      max_val: number;
    }[];

    return rows.map((row) => ({
      ts: row.bucket_ts,
      avg: row.avg_val,
      min: row.min_val,
      max: row.max_val,
    }));
  }

  const rows = ctx.sqlite.prepare(`
    SELECT ts, value
    FROM samples_raw
    WHERE metric_key = ? AND ts >= ? AND ts <= ?
    ORDER BY ts ASC
  `).all(metricId, fromTs, toTs) as { ts: number; value: number }[];

  return rows.map((row) => ({
    ts: row.ts,
    avg: row.value,
    min: row.value,
    max: row.value,
  }));
}

export function getCategories(ctx: DbContext): CategoryInfo[] {
  const grouped = new Map<string, string[]>();
  for (const definition of getMetricDefinitions(ctx)) {
    const metricIds = grouped.get(definition.category) ?? [];
    metricIds.push(definition.id);
    grouped.set(definition.category, metricIds);
  }
  return Array.from(grouped, ([name, metricIds]) => ({ name, metricIds }));
}

export function deleteSamplesOlderThan(ctx: DbContext, cutoffTs: number): number {
  return ctx.sqlite.prepare(`DELETE FROM samples_raw WHERE ts < ?`).run(cutoffTs).changes;
}
