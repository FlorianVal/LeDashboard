import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";

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
