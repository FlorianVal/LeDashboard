import type { FastifyInstance } from "fastify";
import type { SourceManager } from "../sources/manager";

export function registerSourcesRoutes(
  app: FastifyInstance,
  sourceManager: SourceManager
): void {
  app.get("/api/sources", async () => {
    return sourceManager.getSourceStatuses();
  });
}
