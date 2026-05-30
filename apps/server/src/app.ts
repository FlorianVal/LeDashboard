import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadServerConfig, loadSourcesConfig } from "./config";
import { createDatabase } from "./db/client";
import type { DbContext } from "./db/client";
import { SourceManager } from "./sources/manager";
import { registerHealthRoutes } from "./routes/health";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerSourcesRoutes } from "./routes/sources";
import { pruneOldSamples } from "./services/retention";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

    const publicDir = resolve(__dirname, "../../web/dist");
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
