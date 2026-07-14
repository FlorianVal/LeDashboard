import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndpointConfig } from "../src/config.js";
import {
  LaPlanteCollector,
  LeTimelapseCollector,
} from "../src/collectors/house-apps.js";

const plantsConfig: EndpointConfig = {
  url: "http://laplante.test/api/dashboard-summary",
  intervalSeconds: 3600,
};
const timelapseConfig: EndpointConfig = {
  url: "http://letimelapse.test/api/status",
  intervalSeconds: 300,
};

function fetchJsonFixture(body: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const capture = {
  lastSuccessAt: "2026-07-14T12:00:00.000Z",
  lastErrorAt: null,
  lastError: null,
  expectedIntervalSeconds: 30,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("house application collectors", () => {
  it("maps house summaries without detail duplication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const plants = new LaPlanteCollector(
      plantsConfig,
      fetchJsonFixture({ overdueCount: 2, lastWateredOn: "2026-07-13" }),
    );
    const timelapse = new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({
        capture,
        library: { totalBytes: 2048, videoCount: 40 },
      }),
    );

    const results = await Promise.all([plants.collect(), timelapse.collect()]);
    const samples = results.flatMap((result) => result.samples);
    const currentValues = results.flatMap((result) => result.currentValues);

    expect([plants.id, timelapse.id]).toEqual(["laplante", "letimelapse"]);
    expect([plants.intervalSeconds, timelapse.intervalSeconds]).toEqual([3600, 300]);
    expect(samples).toEqual([
      { key: "plants.overdue_count", ts: 1_784_030_400, value: 2 },
      { key: "timelapse.library_bytes", ts: 1_784_030_400, value: 2048 },
    ]);
    expect(currentValues).toEqual([
      { key: "plants.last_watered_on", ts: 1_784_030_400, textValue: "2026-07-13" },
      {
        key: "timelapse.capture_last_success_at",
        ts: 1_784_030_400,
        textValue: "2026-07-14T12:00:00.000Z",
      },
      {
        key: "timelapse.capture_expected_interval_seconds",
        ts: 1_784_030_400,
        numericValue: 30,
      },
    ]);
  });

  it("omits nullable house facts instead of storing numeric or textual zeroes", async () => {
    const plants = new LaPlanteCollector(
      plantsConfig,
      fetchJsonFixture({ overdueCount: 0, lastWateredOn: null }),
    );
    const timelapse = new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({
        capture: {
          lastSuccessAt: null,
          lastErrorAt: null,
          lastError: null,
          expectedIntervalSeconds: 30,
        },
        library: { totalBytes: 0, videoCount: 0 },
      }),
    );

    const [plantResult, timelapseResult] = await Promise.all([
      plants.collect(),
      timelapse.collect(),
    ]);

    expect(plantResult).toMatchObject({
      samples: [{ key: "plants.overdue_count", value: 0 }],
      currentValues: [],
    });
    expect(timelapseResult).toMatchObject({
      samples: [{ key: "timelapse.library_bytes", value: 0 }],
      currentValues: [
        {
          key: "timelapse.capture_expected_interval_seconds",
          numericValue: 30,
        },
      ],
    });
  });

  it("maps a non-null capture error without inventing library details", async () => {
    const collector = new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({
        capture: {
          lastSuccessAt: "2026-07-14T11:59:00.000Z",
          lastErrorAt: "2026-07-14T12:00:00.000Z",
          lastError: "ffmpeg exited unexpectedly",
          expectedIntervalSeconds: 30,
        },
        library: { totalBytes: 2048, videoCount: 40 },
      }),
    );

    const result = await collector.collect();

    expect(result.currentValues.map(({ key, textValue, numericValue }) => ({
      key,
      textValue,
      numericValue,
    }))).toEqual([
      {
        key: "timelapse.capture_last_success_at",
        textValue: "2026-07-14T11:59:00.000Z",
        numericValue: undefined,
      },
      {
        key: "timelapse.capture_last_error_at",
        textValue: "2026-07-14T12:00:00.000Z",
        numericValue: undefined,
      },
      {
        key: "timelapse.capture_last_error",
        textValue: "ffmpeg exited unexpectedly",
        numericValue: undefined,
      },
      {
        key: "timelapse.capture_expected_interval_seconds",
        textValue: undefined,
        numericValue: 30,
      },
    ]);
  });

  it.each([
    ["LaPlante overdue count", new LaPlanteCollector(
      plantsConfig,
      fetchJsonFixture({ lastWateredOn: null }),
    )],
    ["LaPlante watering date", new LaPlanteCollector(
      plantsConfig,
      fetchJsonFixture({ overdueCount: 1 }),
    )],
    ["LeTimelapse library bytes", new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({ capture, library: { videoCount: 1 } }),
    )],
    ["LeTimelapse video count", new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({ capture, library: { totalBytes: 1024 } }),
    )],
  ])("rejects a successful response missing required %s", async (_label, collector) => {
    await expect(collector.collect()).rejects.toThrow();
  });

  it("rejects the removed LeTimelapse lastVideoAt field", async () => {
    const collector = new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({
        capture,
        library: {
          totalBytes: 2048,
          videoCount: 40,
          lastVideoAt: "2026-07-13T23:58:00.000Z",
        },
      }),
    );

    await expect(collector.collect()).rejects.toThrow();
  });

  it("rejects malformed dates and numeric fields", async () => {
    const plants = new LaPlanteCollector(
      plantsConfig,
      fetchJsonFixture({ overdueCount: "2", lastWateredOn: "yesterday" }),
    );
    const timelapse = new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({
        capture: { ...capture, expectedIntervalSeconds: "30" },
        library: { totalBytes: null, videoCount: -1 },
      }),
    );

    await expect(plants.collect()).rejects.toThrow();
    await expect(timelapse.collect()).rejects.toThrow();
  });

  it.each([
    ["LaPlante", new LaPlanteCollector(
      plantsConfig,
      fetchJsonFixture({ message: "failed" }, 503),
    )],
    ["LeTimelapse", new LeTimelapseCollector(
      timelapseConfig,
      fetchJsonFixture({ message: "failed" }, 500),
    )],
  ])("rejects non-successful %s responses", async (_label, collector) => {
    await expect(collector.collect()).rejects.toThrow(/returned HTTP/);
  });

  it.each([
    ["LaPlante", new LaPlanteCollector(
      plantsConfig,
      async () => new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    )],
    ["LeTimelapse", new LeTimelapseCollector(
      timelapseConfig,
      async () => new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    )],
  ])("rejects successful non-JSON %s responses", async (_label, collector) => {
    await expect(collector.collect()).rejects.toThrow(/non-JSON response/);
  });
});
