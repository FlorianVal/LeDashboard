import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { loadCuratedSourcesConfig, loadServerConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import type { DbContext } from "./db/client.js";
import type { MetricKey } from "@ledashboard/shared";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerIncidentRoutes } from "./routes/incidents.js";
import { registerSeriesRoutes } from "./routes/series.js";
import { pruneOldSamples } from "./services/retention.js";
import { MetricsRepository } from "./db/repository.js";
import { IncidentRepository } from "./services/incidents.js";
import { SourceManager, SourceRepository } from "./services/source-manager.js";
import { HomeAssistantCollector } from "./collectors/home-assistant.js";
import { LaPlanteCollector, LeTimelapseCollector } from "./collectors/house-apps.js";
import { MacMetricsCollector, NasMetricsCollector } from "./collectors/prometheus.js";
import { AvailabilityCollector } from "./collectors/availability.js";
import type { CollectionResult } from "./collectors/types.js";

export type BuildAppOptions = {
  databasePath?: string;
  sourcesPath?: string;
  testMode?: boolean;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
};

function captureStatusFrom(result: CollectionResult) {
  const current = new Map(result.currentValues.map((value) => [value.key, value]));
  const lastSuccessAt = current.get("timelapse.capture_last_success_at")?.textValue;
  const lastErrorAt = current.get("timelapse.capture_last_error_at")?.textValue;
  const expectedIntervalSeconds = current
    .get("timelapse.capture_expected_interval_seconds")?.numericValue;
  return typeof expectedIntervalSeconds === "number"
    && Number.isFinite(expectedIntervalSeconds)
    && expectedIntervalSeconds > 0
    ? {
        lastSuccessAt: lastSuccessAt ?? null,
        lastErrorAt: lastErrorAt ?? null,
        expectedIntervalSeconds,
      }
    : null;
}

export function buildApp(options: BuildAppOptions = {}) {
  const config = loadServerConfig();
  const databasePath = options.databasePath ?? config.databasePath;
  const testMode = options.testMode ?? false;
  const now = options.now ?? (() => new Date());
  const sourcesPath = options.sourcesPath ?? config.sourcesPath;
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;

  const ctx: DbContext = createDatabase(databasePath);

  const app = Fastify({ logger: !testMode });
  const repository = new MetricsRepository(ctx.sqlite);
  const sourceRepository = new SourceRepository(ctx.sqlite);
  const incidentRepository = new IncidentRepository(ctx.sqlite);
  let sourceManager: SourceManager | undefined;
  let retentionInterval: ReturnType<typeof setInterval> | undefined;
  const metricDefinitions = new Map(ctx.sqlite.prepare(`
    SELECT key, source_id, display_name, unit, stale_after_seconds
    FROM metric_definitions
  `).all().map((row) => {
    const definition = row as {
      key: MetricKey;
      source_id: string;
      display_name: string;
      unit: string;
      stale_after_seconds: number;
    };
    return [definition.key, {
      key: definition.key,
      sourceId: definition.source_id,
      displayName: definition.display_name,
      unit: definition.unit,
      staleAfterSeconds: definition.stale_after_seconds,
    }] as const;
  }));

  registerHealthRoutes(app);
  registerMetricsRoutes(app, ctx);
  registerDashboardRoutes(app, {
    repository,
    sourceRepository,
    incidentRepository,
    metricDefinitions,
    now,
  });
  registerSeriesRoutes(app, { repository, metricDefinitions, now });
  registerIncidentRoutes(app, incidentRepository, now);

  if (!testMode) {
    const sources = loadCuratedSourcesConfig(sourcesPath);
    pruneOldSamples(ctx);
    retentionInterval = setInterval(() => pruneOldSamples(ctx), 86400_000);
    retentionInterval.unref?.();

    sourceManager = new SourceManager(sourceRepository, now, {
      diagnostic: ({ sourceId, category }) => {
        app.log.warn({ sourceId, category }, "Scheduled collector failure");
      },
      onSuccess: (collector, result, attemptedAt) => {
        if (collector.id !== "letimelapse") return;
        const capture = captureStatusFrom(result);
        if (capture !== null) {
          incidentRepository.applyCaptureStatus(capture, attemptedAt);
        }
      },
    });
    sourceManager.start([
      new HomeAssistantCollector(
        sources.homeAssistant,
        fetchImpl,
        requestTimeoutMs,
      ),
      new LaPlanteCollector(sources.laPlante, fetchImpl, requestTimeoutMs),
      new LeTimelapseCollector(
        sources.leTimelapse,
        fetchImpl,
        requestTimeoutMs,
      ),
      new MacMetricsCollector(
        sources.mac,
        fetchImpl,
        () => Math.floor(now().getTime() / 1_000),
        requestTimeoutMs,
      ),
      new NasMetricsCollector(
        sources.nas,
        fetchImpl,
        () => Math.floor(now().getTime() / 1_000),
        requestTimeoutMs,
      ),
      new AvailabilityCollector(sources.services, incidentRepository, {
        fetchImpl,
        now,
      }),
    ]);

    const publicDir = resolve("public");
    if (existsSync(publicDir)) {
      app.register(fastifyStatic, {
        root: publicDir,
        prefix: "/",
      });

      app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith("/api/")) {
          return reply.status(404).send({ error: "Not found" });
        }
        const indexPath = resolve(publicDir, "index.html");
        if (existsSync(indexPath)) {
          return reply.type("text/html").send(readFileSync(indexPath, "utf-8"));
        }
        return reply.status(404).send({ error: "Not found" });
      });
    }
  }

  app.addHook("onClose", async () => {
    await sourceManager?.stop();
    if (retentionInterval !== undefined) clearInterval(retentionInterval);
    ctx.sqlite.close();
  });

  return app;
}
