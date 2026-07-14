import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/db/client.js";
import { MetricsRepository } from "../src/db/repository.js";
import { IncidentRepository } from "../src/services/incidents.js";
import { SourceRepository } from "../src/services/source-manager.js";

const DAY = 86_400;

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function setup(now = new Date("2026-07-14T12:00:00.000Z")) {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-routes-"));
  const databasePath = join(directory, "ledashboard-v2.sqlite");
  const ctx = createDatabase(databasePath);
  const repository = new MetricsRepository(ctx.sqlite);
  const sources = new SourceRepository(ctx.sqlite);
  const incidents = new IncidentRepository(ctx.sqlite);
  let app: FastifyInstance | undefined;

  cleanups.push(async () => {
    await app?.close();
    if (ctx.sqlite.open) ctx.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  return {
    now,
    ctx,
    repository,
    sources,
    incidents,
    build() {
      ctx.sqlite.close();
      app = buildApp({
        databasePath,
        sourcesPath: join(directory, "missing-sources.yaml"),
        testMode: true,
        now: () => now,
      });
      return app;
    },
  };
}

function markAllSourcesSuccessful(
  sources: SourceRepository,
  at: string,
): void {
  for (const sourceId of [
    "home-assistant",
    "laplante",
    "letimelapse",
    "mac",
    "nas",
    "availability",
  ]) {
    sources.commitSuccess(sourceId, at, { samples: [], currentValues: [] });
  }
}

function seedHourlyNasDays(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
  now: Date,
  days: number,
  dailyGrowth: number,
): void {
  const insert = sqlite.prepare(`
    INSERT INTO samples_rollup
      (metric_key, bucket_seconds, ts, avg, min, max)
    VALUES (?, 3600, ?, ?, ?, ?)
  `);
  const startOfToday = Math.floor(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ) / 1_000);
  for (let day = days; day >= 1; day -= 1) {
    const dayStart = startOfToday - day * DAY;
    const value = 1_000 + (days - day) * dailyGrowth;
    for (let hour = 0; hour < 24; hour += 1) {
      const ts = dayStart + hour * 3_600;
      insert.run("nas.storage_used_bytes", ts, value, value, value);
    }
  }
}

function seedHourlyNasDay(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
  dayStart: number,
  value: number,
  hours = 24,
): void {
  const insert = sqlite.prepare(`
    INSERT INTO samples_rollup
      (metric_key, bucket_seconds, ts, avg, min, max)
    VALUES (?, 3600, ?, ?, ?, ?)
  `);
  for (let hour = 0; hour < hours; hour += 1) {
    const ts = dayStart + hour * 3_600;
    insert.run("nas.storage_used_bytes", ts, value, value, value);
  }
}

describe("curated dashboard routes", () => {
  it("returns healthy charts when one source is in error", async () => {
    const { now, repository, sources, build } = setup();
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    repository.insertSamples([
      { key: "comfort.indoor_temperature", ts: nowSeconds, value: 21.5 },
      { key: "comfort.outdoor_temperature", ts: nowSeconds, value: 25 },
      { key: "comfort.climate_target", ts: nowSeconds, value: 22 },
    ]);
    sources.commitSuccess("home-assistant", now.toISOString(), {
      samples: [],
      currentValues: [],
    });
    sources.recordFailure("nas", now.toISOString(), "Collection failed for nas");

    const response = await build().inject({ method: "GET", url: "/api/dashboard" });

    expect(response.statusCode).toBe(200);
    expect(response.json().charts.comfort.series).toHaveLength(3);
    expect(response.json().charts.nasStorage.series[0].samples).toEqual([]);
    expect(response.json().sources.nas.state).toBe("error");
  });

  it("returns exactly seven fixed charts at their independent resolutions without filling gaps", async () => {
    const { now, ctx, repository, sources, build } = setup();
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    markAllSourcesSuccessful(sources, now.toISOString());
    repository.insertSamples([
      { key: "comfort.indoor_temperature", ts: nowSeconds - 600, value: 20 },
      { key: "comfort.indoor_temperature", ts: nowSeconds, value: 21 },
    ]);
    const insertRollup = ctx.sqlite.prepare(`
      INSERT INTO samples_rollup
        (metric_key, bucket_seconds, ts, avg, min, max)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertRollup.run(
      "plants.overdue_count",
      300,
      nowSeconds - 10 * DAY,
      2,
      2,
      2,
    );
    insertRollup.run(
      "timelapse.library_bytes",
      3600,
      nowSeconds - 100 * DAY,
      5_000,
      5_000,
      5_000,
    );

    const response = await build().inject({ method: "GET", url: "/api/dashboard" });
    const body = response.json();

    expect(Object.keys(body)).toEqual([
      "generatedAt",
      "overallState",
      "charts",
      "facts",
      "supportingFacts",
      "sources",
      "activeIncidents",
    ]);
    expect(Object.keys(body.charts)).toEqual([
      "comfort",
      "plants",
      "timelapseStorage",
      "macResources",
      "macNetwork",
      "nasStorage",
      "availability",
    ]);
    expect(Object.values(body.charts).map((chart: any) => chart.windowSeconds))
      .toEqual([DAY, 30 * DAY, 180 * DAY, DAY, DAY, 180 * DAY, 30 * DAY]);
    expect(body.charts.comfort.series[0].samples).toEqual([
      { ts: nowSeconds - 600, avg: 20, min: 20, max: 20 },
      { ts: nowSeconds, avg: 21, min: 21, max: 21 },
    ]);
    expect(body.charts.plants.series[0].samples).toHaveLength(1);
    expect(body.charts.timelapseStorage.series[0].samples).toHaveLength(1);
    expect(Object.values(body.charts).flatMap((chart: any) => chart.series))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "observed" }),
      ]));
    expect(Object.values(body.charts).flatMap((chart: any) => chart.series)
      .every((series: any) => series.kind === "observed")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/Raspberry|categories/iu);
  });

  it("derives facts, source freshness, active incidents, and overall state from persisted state at now", async () => {
    const { now, repository, sources, incidents, build } = setup();
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    markAllSourcesSuccessful(sources, now.toISOString());
    sources.commitSuccess(
      "mac",
      new Date(now.getTime() - 181_000).toISOString(),
      { samples: [], currentValues: [] },
    );
    repository.setCurrentValues([
      { key: "weather.condition", ts: 1, textValue: "sunny" },
      { key: "plants.last_watered_on", ts: 1, textValue: "2026-07-13" },
      {
        key: "timelapse.capture_last_success_at",
        ts: 1,
        textValue: now.toISOString(),
      },
      {
        key: "timelapse.capture_expected_interval_seconds",
        ts: 1,
        numericValue: 30,
      },
    ]);
    repository.insertSamples([
      { key: "weather.humidity", ts: nowSeconds - 300, value: 50 },
      { key: "weather.humidity", ts: nowSeconds, value: 53 },
      { key: "weather.pressure", ts: nowSeconds - 60, value: 1_015 },
    ]);
    const service = { id: "plex", name: "Plex" };
    const failed = {
      available: false,
      slow: false,
      latencyMs: null,
      error: "timeout" as const,
    };
    incidents.applyCheck(service, failed, "2026-07-14T11:58:00.000Z");
    incidents.applyCheck(service, failed, "2026-07-14T11:59:00.000Z");

    const body = (await build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();

    expect(body.generatedAt).toBe(now.toISOString());
    expect(body.facts["weather.condition"].textValue).toBe("sunny");
    expect(body.facts["plants.last_watered_on"].textValue).toBe("2026-07-13");
    expect(body.facts).not.toHaveProperty("timelapse.lastVideoAt");
    expect(body.supportingFacts.weather).toEqual({
      humidity: { ts: nowSeconds, value: 53, unit: "%" },
      pressure: { ts: nowSeconds - 60, value: 1_015, unit: "hPa" },
      windSpeed: null,
      condition: { ts: 1, value: "sunny" },
    });
    expect(body.sources.mac.state).toBe("stale");
    expect(body.sources["home-assistant"].state).toBe("fresh");
    expect(body.activeIncidents).toEqual([
      expect.objectContaining({ serviceId: "plex", endedAt: null }),
    ]);
    expect(body.overallState).toBe("down");
  });

  it.each([
    { ageSeconds: 89, expectedSource: "fresh", expectedOverall: "healthy" },
    { ageSeconds: 90, expectedSource: "stale", expectedOverall: "degraded" },
    { ageSeconds: 180, expectedSource: "error", expectedOverall: "down" },
  ])("maps a capture heartbeat aged $ageSeconds seconds", async ({
    ageSeconds,
    expectedSource,
    expectedOverall,
  }) => {
    const { now, repository, sources, build } = setup();
    markAllSourcesSuccessful(sources, now.toISOString());
    repository.setCurrentValues([
      {
        key: "timelapse.capture_last_success_at",
        ts: 1,
        textValue: new Date(now.getTime() - ageSeconds * 1_000).toISOString(),
      },
      {
        key: "timelapse.capture_expected_interval_seconds",
        ts: 1,
        numericValue: 30,
      },
    ]);

    const body = (await build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();

    expect(body.sources.letimelapse.state).toBe(expectedSource);
    expect(body.overallState).toBe(expectedOverall);
  });

  it("marks capture down when its latest error is newer than its latest success", async () => {
    const { now, repository, sources, build } = setup();
    markAllSourcesSuccessful(sources, now.toISOString());
    repository.setCurrentValues([
      {
        key: "timelapse.capture_last_success_at",
        ts: 1,
        textValue: "2026-07-14T11:59:30.000Z",
      },
      {
        key: "timelapse.capture_last_error_at",
        ts: 1,
        textValue: "2026-07-14T11:59:45.000Z",
      },
      {
        key: "timelapse.capture_expected_interval_seconds",
        ts: 1,
        numericValue: 30,
      },
    ]);

    const body = (await build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    expect(body.sources.letimelapse.state).toBe("error");
    expect(body.overallState).toBe("down");
  });

  it("marks capture down when an error exists before any valid success", async () => {
    const { now, repository, sources, build } = setup();
    markAllSourcesSuccessful(sources, now.toISOString());
    repository.setCurrentValues([
      {
        key: "timelapse.capture_last_error_at",
        ts: 1,
        textValue: "2026-07-14T11:59:45.000Z",
      },
      {
        key: "timelapse.capture_expected_interval_seconds",
        ts: 1,
        numericValue: 30,
      },
    ]);

    const body = (await build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    expect(body.sources.letimelapse.state).toBe("error");
    expect(body.overallState).toBe("down");
  });

  it.each([
    { ageMs: 179_999, expected: "fresh" },
    { ageMs: 180_000, expected: "stale" },
    { ageMs: 180_001, expected: "stale" },
  ])("uses exact milliseconds at the source freshness boundary ($ageMs ms)", async ({
    ageMs,
    expected,
  }) => {
    const now = new Date("2026-07-14T12:00:00.500Z");
    const setupResult = setup(now);
    markAllSourcesSuccessful(setupResult.sources, now.toISOString());
    setupResult.sources.commitSuccess(
      "mac",
      new Date(now.getTime() - ageMs).toISOString(),
      { samples: [], currentValues: [] },
    );

    const body = (await setupResult.build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    expect(body.sources.mac.state).toBe(expected);
  });

  it("selects raw, five-minute, and hourly series and preserves missing intervals", async () => {
    const { now, ctx, repository, build } = setup();
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    repository.insertSamples([
      { key: "mac.cpu_percent", ts: nowSeconds - DAY, value: 11 },
      { key: "mac.cpu_percent", ts: nowSeconds, value: 22 },
    ]);
    const insertRollup = ctx.sqlite.prepare(`
      INSERT INTO samples_rollup
        (metric_key, bucket_seconds, ts, avg, min, max)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertRollup.run("mac.cpu_percent", 300, nowSeconds - 10 * DAY, 33, 30, 35);
    insertRollup.run("mac.cpu_percent", 3600, nowSeconds - 100 * DAY, 44, 40, 50);
    const app = build();

    const raw = (await app.inject({
      method: "GET",
      url: `/api/series/mac.cpu_percent?from=${nowSeconds - 2 * DAY}&to=${nowSeconds}`,
    })).json();
    const fiveMinute = (await app.inject({
      method: "GET",
      url: `/api/series/mac.cpu_percent?from=${nowSeconds - 20 * DAY}&to=${nowSeconds}`,
    })).json();
    const hourly = (await app.inject({
      method: "GET",
      url: `/api/series/mac.cpu_percent?from=${nowSeconds - 180 * DAY}&to=${nowSeconds}`,
    })).json();

    expect(raw).toMatchObject({ resolution: "raw", from: nowSeconds - 2 * DAY, to: nowSeconds });
    expect(raw.samples).toHaveLength(2);
    expect(fiveMinute).toMatchObject({ resolution: "5m" });
    expect(fiveMinute.samples).toEqual([
      { ts: nowSeconds - 10 * DAY, avg: 33, min: 30, max: 35 },
    ]);
    expect(hourly).toMatchObject({ resolution: "1h" });
    expect(hourly.samples).toHaveLength(1);
  });

  it.each([
    "/api/series/mac.cpu_percent?from=nope&to=10",
    "/api/series/mac.cpu_percent?from=10&to=10",
    "/api/series/mac.cpu_percent?from=11&to=10",
    `/api/series/mac.cpu_percent?from=0&to=${180 * DAY + 1}`,
    "/api/incidents?from=nope&to=10",
    "/api/incidents?from=11&to=10",
  ])("rejects invalid range %s", async (url) => {
    const response = await setup().build().inject({ method: "GET", url });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid time range" });
  });

  it("returns 404 for a non-curated series key", async () => {
    const response = await setup().build().inject({
      method: "GET",
      url: "/api/series/raspberry.cpu?from=1&to=2",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Series not found" });
  });

  it("filters incident history to incidents overlapping the requested range", async () => {
    const { incidents, build } = setup();
    const service = { id: "plex", name: "Plex" };
    const failed = { available: false, slow: false, latencyMs: null, error: "timeout" as const };
    const healthy = { available: true, slow: false, latencyMs: 20, error: null };
    incidents.applyCheck(service, failed, "2026-07-14T10:00:00.000Z");
    incidents.applyCheck(service, failed, "2026-07-14T10:01:00.000Z");
    incidents.applyCheck(service, healthy, "2026-07-14T10:02:00.000Z");
    incidents.applyCheck(service, healthy, "2026-07-14T10:03:00.000Z");
    const from = Date.parse("2026-07-14T10:00:30.000Z") / 1_000;
    const to = Date.parse("2026-07-14T10:02:30.000Z") / 1_000;

    const response = await build().inject({
      method: "GET",
      url: `/api/incidents?from=${from}&to=${to}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        serviceId: "plex",
        startedAt: "2026-07-14T10:01:00.000Z",
        endedAt: "2026-07-14T10:03:00.000Z",
      }),
    ]);
  });

  it("exposes persisted source state without config URLs, tokens, or raw errors", async () => {
    const { now, sources, build } = setup();
    sources.recordFailure(
      "home-assistant",
      now.toISOString(),
      "https://user:password@home.test/api?token=super-secret refused",
    );

    const response = await build().inject({ method: "GET", url: "/api/sources" });
    const serialized = JSON.stringify(response.json());
    expect(response.statusCode).toBe(200);
    expect(response.json()["home-assistant"]).toMatchObject({
      state: "error",
      lastSuccessAt: null,
      lastError: "Collection failed for home-assistant",
    });
    expect(serialized).not.toContain("home.test");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toMatch(/url|token/i);
  });

  it("omits NAS projection until seven complete days exist", async () => {
    const { now, ctx, build } = setup();
    seedHourlyNasDays(ctx.sqlite, now, 6, 100);

    const body = (await build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    expect(body.charts.nasStorage.series.map((series: any) => series.name))
      .not.toContain("Projected usage");
  });

  it("adds NAS projection at seven complete growing days and omits non-positive growth", async () => {
    const growing = setup();
    seedHourlyNasDays(growing.ctx.sqlite, growing.now, 7, 100);
    const growingBody = (await growing.build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    const projection = growingBody.charts.nasStorage.series.find(
      (series: any) => series.name === "Projected usage",
    );
    const observed = growingBody.charts.nasStorage.series.find(
      (series: any) => series.name === "NAS storage used",
    );
    expect(observed).toMatchObject({
      key: "nas.storage_used_bytes",
      kind: "observed",
    });
    expect(projection).toMatchObject({
      key: "nas.storage_used_bytes",
      kind: "projection",
    });
    expect(projection.samples).toHaveLength(2);
    expect(projection.samples[1].avg).toBeGreaterThan(projection.samples[0].avg);

    const shrinking = setup();
    seedHourlyNasDays(shrinking.ctx.sqlite, shrinking.now, 7, -100);
    const shrinkingBody = (await shrinking.build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    expect(shrinkingBody.charts.nasStorage.series.map((series: any) => series.name))
      .not.toContain("Projected usage");
  });

  it("selects older complete NAS days when recent hourly coverage is incomplete", async () => {
    const setupResult = setup();
    const startOfToday = Math.floor(
      setupResult.now.getTime() / 1_000 / DAY,
    ) * DAY;
    for (let offset = 40; offset >= 34; offset -= 1) {
      seedHourlyNasDay(
        setupResult.ctx.sqlite,
        startOfToday - offset * DAY,
        1_000 + (40 - offset) * 100,
      );
    }
    seedHourlyNasDay(
      setupResult.ctx.sqlite,
      startOfToday - DAY,
      9_000,
      23,
    );

    const body = (await setupResult.build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    const projection = body.charts.nasStorage.series.find(
      (series: any) => series.kind === "projection",
    );
    expect(projection.samples).toHaveLength(2);
    expect(projection.samples[0].ts).toBe(startOfToday - 34 * DAY);
  });

  it("regresses NAS growth against actual UTC day offsets across a calendar gap", async () => {
    const setupResult = setup();
    const startOfToday = Math.floor(
      setupResult.now.getTime() / 1_000 / DAY,
    ) * DAY;
    const offsets = [12, 11, 10, 8, 7, 6, 5];
    for (const offset of offsets) {
      seedHourlyNasDay(
        setupResult.ctx.sqlite,
        startOfToday - offset * DAY,
        1_000 + (12 - offset) * 100,
      );
    }

    const body = (await setupResult.build().inject({
      method: "GET",
      url: "/api/dashboard",
    })).json();
    const projection = body.charts.nasStorage.series.find(
      (series: any) => series.kind === "projection",
    );
    expect(projection.samples[0]).toMatchObject({
      ts: startOfToday - 5 * DAY,
      avg: 1_700,
    });
    expect(projection.samples[1]).toMatchObject({
      ts: startOfToday + 25 * DAY,
      avg: 4_700,
    });
  });
});
