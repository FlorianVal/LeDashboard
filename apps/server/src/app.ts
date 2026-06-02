import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { loadServerConfig, loadSourcesConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import type { DbContext } from "./db/client.js";
import { SourceManager } from "./sources/manager.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerSourcesRoutes } from "./routes/sources.js";
import { pruneOldSamples } from "./services/retention.js";

export type BuildAppOptions = {
  databasePath?: string;
  sourcesPath?: string;
  testMode?: boolean;
};

export function buildApp(options: BuildAppOptions = {}) {
  const config = loadServerConfig();
  const databasePath = options.databasePath ?? config.databasePath;
  const sourcesPath = options.sourcesPath ?? config.sourcesPath;
  const testMode = options.testMode ?? false;

  const ctx: DbContext = createDatabase(databasePath);

  // Migration: fix auto-registered network metrics with wrong category
  const migrationResult = ctx.sqlite
    .prepare(
      `UPDATE metric_definitions
       SET category = 'network',
           display_name = CASE
             WHEN name LIKE '%node_network_receive_bytes_total%' THEN 'Réception Réseau'
             WHEN name LIKE '%node_network_transmit_bytes_total%' THEN 'Émission Réseau'
             ELSE display_name
           END
       WHERE name LIKE 'node_network_%'
         AND category = 'auto'`
    )
    .run();
  if (migrationResult.changes > 0) {
    console.log(
      `Migration: fixed ${migrationResult.changes} network metrics (category + display name)`
    );
  }

  const sourcesConfig = loadSourcesConfig(sourcesPath);

  const app = Fastify({ logger: !testMode });

  const sourceManager = new SourceManager(sourcesConfig, ctx);

  registerHealthRoutes(app);
  registerMetricsRoutes(app, ctx);
  registerSourcesRoutes(app, sourceManager);

  if (!testMode) {
    sourceManager.initialize().then(() => sourceManager.startCollection());

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
    sourceManager.stopCollection();
    ctx.sqlite.close();
  });

  return app;
}
