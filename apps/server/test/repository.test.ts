import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { MetricsRepository } from "../src/db/repository.js";

function temporaryDatabasePath(): string {
  return join(mkdtempSync(join(tmpdir(), "ledashboard-")), "ledashboard-v2.sqlite");
}

describe("MetricsRepository", () => {
  it("stores idempotent samples and typed current values", () => {
    const ctx = createDatabase(temporaryDatabasePath());
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
    ctx.sqlite.close();
  });

  it("selects five-minute and hourly rollups explicitly", () => {
    const ctx = createDatabase(temporaryDatabasePath());
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
    ctx.sqlite.close();
  });
});
