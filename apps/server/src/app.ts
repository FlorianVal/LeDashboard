import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { loadServerConfig } from "./config.js";
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
import { SourceRepository } from "./services/source-manager.js";

export type BuildAppOptions = {
  databasePath?: string;
  sourcesPath?: string;
  testMode?: boolean;
  now?: () => Date;
};

export function buildApp(options: BuildAppOptions = {}) {
  const config = loadServerConfig();
  const databasePath = options.databasePath ?? config.databasePath;
  const testMode = options.testMode ?? false;
  const now = options.now ?? (() => new Date());

  const ctx: DbContext = createDatabase(databasePath);

  const app = Fastify({ logger: !testMode });
  const repository = new MetricsRepository(ctx.sqlite);
  const sourceRepository = new SourceRepository(ctx.sqlite);
  const incidentRepository = new IncidentRepository(ctx.sqlite);
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
    pruneOldSamples(ctx);
    setInterval(() => pruneOldSamples(ctx), 86400_000);

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
    ctx.sqlite.close();
  });

  return app;
}
