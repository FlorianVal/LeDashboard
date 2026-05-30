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
