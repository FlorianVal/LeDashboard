import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";

async function eventually(
  assertion: () => Promise<void> | void,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await assertion();
}

it("starts and serves routes against a fresh v2 database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-app-"));
  let app: FastifyInstance | undefined;
  try {
    app = buildApp({
      databasePath: join(directory, "ledashboard-v2.sqlite"),
      sourcesPath: join(directory, "missing-sources.yaml"),
      testMode: true,
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    const metrics = await app.inject({ method: "GET", url: "/api/metrics" });

    expect(health.statusCode).toBe(200);
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json()).toHaveLength(16);
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("wires and promptly runs every curated collector on the real production path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-production-app-"));
  const databasePath = join(directory, "ledashboard-v2.sqlite");
  const sourcesPath = join(directory, "sources.yaml");
  writeFileSync(sourcesPath, `
homeAssistant: { url: http://house.test/ha/api, token: secret, intervalSeconds: 300 }
laPlante: { url: http://house.test/plants, intervalSeconds: 3600 }
leTimelapse: { url: http://house.test/timelapse, intervalSeconds: 300 }
mac: { url: http://house.test/mac, username: metrics, password: secret, intervalSeconds: 60, interface: en0 }
nas: { url: http://house.test/nas, intervalSeconds: 300, mountpoint: /share/CACHEDEV1_DATA }
services:
  - { id: maison, name: Maison, url: http://house.test/health, expectedStatuses: [200], latencyThresholdMs: 1000 }
`);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("climate.air_conditioner")) return Response.json({ attributes: { current_temperature: 21, temperature: 22 } });
    if (url.endsWith("weather.forecast_maison")) return Response.json({ state: "sunny", attributes: { temperature: 18, humidity: 50 } });
    if (url.endsWith("/plants")) return Response.json({ overdueCount: 2, lastWateredOn: "2026-07-13" });
    if (url.endsWith("/timelapse")) return Response.json({ capture: { lastSuccessAt: "2026-07-14T11:59:50.000Z", lastErrorAt: null, lastError: null, expectedIntervalSeconds: 30 }, library: { totalBytes: 2048, videoCount: 4 } });
    if (url.endsWith("/mac")) return new Response('cpu_usage_active 20\nmem_used_percent 60\ndisk_used_percent{path="/"} 40\nnet_bytes_recv{interface="en0"} 100\nnet_bytes_sent{interface="en0"} 200');
    if (url.endsWith("/nas")) return new Response('node_filesystem_size_bytes{mountpoint="/share/CACHEDEV1_DATA"} 10000\nnode_filesystem_avail_bytes{mountpoint="/share/CACHEDEV1_DATA"} 7000');
    return new Response("ok");
  };
  let app: FastifyInstance | undefined;
  try {
    app = buildApp({
      databasePath,
      sourcesPath,
      fetchImpl,
    });

    await eventually(async () => {
      const dashboard = await app!.inject({ method: "GET", url: "/api/dashboard" });
      const body = dashboard.json();
      expect(body.charts.comfort.series[0].samples).not.toEqual([]);
      expect(body.charts.plants.series[0].samples).not.toEqual([]);
      expect(body.charts.timelapseStorage.series[0].samples).not.toEqual([]);
      expect(body.charts.macResources.series[0].samples).not.toEqual([]);
      expect(body.charts.nasStorage.series[0].samples).not.toEqual([]);
      expect(body.charts.availability.series[0].samples).not.toEqual([]);
    });
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("defaults every deployment entry point to the v2 database", () => {
  expect(readFileSync(new URL("../../../Dockerfile", import.meta.url), "utf8"))
    .toContain("DATABASE_PATH=/app/data/ledashboard-v2.sqlite");
  expect(readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8"))
    .toContain("DATABASE_PATH=/app/data/ledashboard-v2.sqlite");
});
