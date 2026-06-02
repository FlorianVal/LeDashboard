import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import type { DbContext } from "./client.js";
import { metricDefinitions } from "./schema.js";
import type { MetricDef, Sample, CategoryInfo } from "@ledashboard/shared";

export function insertMetricDef(
  ctx: DbContext,
  metric: Omit<MetricDef, "labels"> & { labelsJson?: string | null }
): void {
  ctx.sqlite
    .prepare(
      `INSERT OR REPLACE INTO metric_definitions (id, source_id, name, display_name, category, unit, labels_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      metric.id,
      metric.sourceId,
      metric.name,
      metric.displayName,
      metric.category,
      metric.unit ?? null,
      metric.labelsJson ?? null,
      new Date().toISOString()
    );
}

export function insertSamplesBatch(
  ctx: DbContext,
  items: { metricId: string; ts: number; value: number }[]
): void {
  if (items.length === 0) return;
  const stmt = ctx.sqlite.prepare(
    `INSERT OR IGNORE INTO samples (id, metric_id, ts, value) VALUES (?, ?, ?, ?)`
  );
  const insert = ctx.sqlite.transaction(
    (rows: { metricId: string; ts: number; value: number }[]) => {
      for (const row of rows) {
        stmt.run(uuid(), row.metricId, row.ts, row.value);
      }
    }
  );
  insert(items);
}

export function getMetricDefinitions(ctx: DbContext): MetricDef[] {
  const rows = ctx.db.select().from(metricDefinitions).all();
  return rows.map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    name: r.name,
    displayName: r.displayName,
    category: r.category,
    unit: r.unit,
    labels: r.labelsJson ? JSON.parse(r.labelsJson) : {},
  }));
}

export function getMetricDefinition(
  ctx: DbContext,
  id: string
): MetricDef | null {
  const row = ctx.db
    .select()
    .from(metricDefinitions)
    .where(eq(metricDefinitions.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.sourceId,
    name: row.name,
    displayName: row.displayName,
    category: row.category,
    unit: row.unit,
    labels: row.labelsJson ? JSON.parse(row.labelsJson) : {},
  };
}

export function getSamples(
  ctx: DbContext,
  metricId: string,
  fromTs: number,
  toTs: number,
  windowSeconds?: number
): Sample[] {
  if (windowSeconds && windowSeconds > 0) {
    const bucket = Math.floor(windowSeconds);
    const rows = ctx.sqlite
      .prepare(
        `SELECT (ts / ?) * ? AS bucket_ts,
                AVG(value) AS avg_val,
                MIN(value) AS min_val,
                MAX(value) AS max_val
         FROM samples
         WHERE metric_id = ? AND ts >= ? AND ts <= ?
         GROUP BY bucket_ts
         ORDER BY bucket_ts ASC`
      )
      .all(bucket, bucket, metricId, fromTs, toTs) as {
      bucket_ts: number;
      avg_val: number;
      min_val: number;
      max_val: number;
    }[];

    return rows.map((r) => ({
      ts: r.bucket_ts,
      avg: r.avg_val,
      min: r.min_val,
      max: r.max_val,
    }));
  }

  const rows = ctx.sqlite
    .prepare(
      `SELECT ts, value FROM samples
       WHERE metric_id = ? AND ts >= ? AND ts <= ?
       ORDER BY ts ASC`
    )
    .all(metricId, fromTs, toTs) as { ts: number; value: number }[];

  return rows.map((r) => ({ ts: r.ts, avg: r.value }));
}

export function getCategories(ctx: DbContext): CategoryInfo[] {
  const defs = getMetricDefinitions(ctx);
  const grouped = new Map<string, string[]>();
  for (const def of defs) {
    const ids = grouped.get(def.category) ?? [];
    ids.push(def.id);
    grouped.set(def.category, ids);
  }
  const CATEGORY_ORDER = ["environment", "system", "network", "device"];

  return Array.from(grouped.entries())
    .sort((a, b) => {
      const aIdx = CATEGORY_ORDER.indexOf(a[0]);
      const bIdx = CATEGORY_ORDER.indexOf(b[0]);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a[0].localeCompare(b[0]);
    })
    .map(([name, metricIds]) => ({
      name,
      metricIds,
    }));
}

export function deleteSamplesOlderThan(
  ctx: DbContext,
  cutoffTs: number
): number {
  const result = ctx.sqlite
    .prepare(`DELETE FROM samples WHERE ts < ?`)
    .run(cutoffTs);
  return result.changes;
}
