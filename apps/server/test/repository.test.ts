import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { METRIC_KEYS } from "@ledashboard/shared";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { MetricsRepository } from "../src/db/repository.js";

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-"));
  const ctx = createDatabase(join(directory, "ledashboard-v2.sqlite"));
  return {
    ctx,
    cleanup() {
      ctx.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe("MetricsRepository", () => {
  it("creates only the v2 tables and all 16 distinct metric definitions", () => {
    const { ctx, cleanup } = temporaryDatabase();
    try {
      const tables = ctx.sqlite.prepare(`
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];
      const definitions = ctx.sqlite.prepare(`
        SELECT key FROM metric_definitions ORDER BY key
      `).all() as { key: string }[];

      expect(tables.map(({ name }) => name)).toEqual([
        "current_values",
        "incidents",
        "metric_definitions",
        "samples_raw",
        "samples_rollup",
        "service_state",
        "source_state",
      ]);
      expect(definitions.map(({ key }) => key)).toEqual([...METRIC_KEYS].sort());
      expect(new Set(definitions.map(({ key }) => key)).size).toBe(16);
    } finally {
      cleanup();
    }
  });

  it("stores idempotent samples and typed current values", () => {
    const { ctx, cleanup } = temporaryDatabase();
    try {
      const repository = new MetricsRepository(ctx.sqlite);
      repository.insertSamples([
        { key: "comfort.indoor_temperature", ts: 100, value: 22.5 },
        { key: "comfort.indoor_temperature", ts: 100, value: 22.5 },
      ]);
      repository.setCurrentValues([
        { key: "weather.condition", ts: 100, textValue: "partlycloudy" },
      ]);

      expect(repository.getSeries("comfort.indoor_temperature", 0, 200, "raw"))
        .toEqual([{ ts: 100, avg: 22.5, min: 22.5, max: 22.5 }]);
      expect(repository.getCurrentValue("weather.condition")?.textValue)
        .toBe("partlycloudy");
    } finally {
      cleanup();
    }
  });

  it("selects five-minute and hourly rollups explicitly", () => {
    const { ctx, cleanup } = temporaryDatabase();
    try {
      const repository = new MetricsRepository(ctx.sqlite);
      const insert = ctx.sqlite.prepare(`
        INSERT INTO samples_rollup
          (metric_key, bucket_seconds, ts, avg, min, max)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insert.run("mac.cpu_percent", 300, 300, 20, 10, 30);
      insert.run("mac.cpu_percent", 3600, 3600, 40, 25, 55);

      expect(repository.getSeries("mac.cpu_percent", 0, 4000, "5m"))
        .toEqual([{ ts: 300, avg: 20, min: 10, max: 30 }]);
      expect(repository.getSeries("mac.cpu_percent", 0, 4000, "1h"))
        .toEqual([{ ts: 3600, avg: 40, min: 25, max: 55 }]);
    } finally {
      cleanup();
    }
  });

  it("aggregates a fresh raw tail immediately for five-minute reads", () => {
    const { ctx, cleanup } = temporaryDatabase();
    try {
      const repository = new MetricsRepository(ctx.sqlite);
      repository.insertSamples([
        { key: "mac.cpu_percent", ts: 601, value: 20 },
        { key: "mac.cpu_percent", ts: 660, value: 40 },
      ]);

      expect(repository.getSeries("mac.cpu_percent", 0, 900, "5m"))
        .toEqual([{ ts: 600, avg: 30, min: 20, max: 40 }]);
    } finally {
      cleanup();
    }
  });

  it("lets raw tail aggregation replace a persisted boundary bucket without duplicates", () => {
    const { ctx, cleanup } = temporaryDatabase();
    try {
      const repository = new MetricsRepository(ctx.sqlite);
      ctx.sqlite.prepare(`
        INSERT INTO samples_rollup
          (metric_key, bucket_seconds, ts, avg, min, max)
        VALUES (?, 300, ?, ?, ?, ?)
      `).run("mac.cpu_percent", 600, 10, 10, 10);
      repository.insertSamples([
        { key: "mac.cpu_percent", ts: 650, value: 30 },
        { key: "mac.cpu_percent", ts: 700, value: 50 },
      ]);

      expect(repository.getSeries("mac.cpu_percent", 0, 900, "5m"))
        .toEqual([{ ts: 600, avg: 40, min: 30, max: 50 }]);
    } finally {
      cleanup();
    }
  });
});
