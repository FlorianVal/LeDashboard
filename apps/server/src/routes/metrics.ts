import type { FastifyInstance } from "fastify";
import type { DbContext } from "../db/client.js";
import {
  getMetricDefinitions,
  getMetricDefinition,
  getSamples,
  getCategories,
} from "../db/queries.js";
import { unixTimestamp, secondsAgo, computeWindow } from "@ledashboard/shared";

export function registerMetricsRoutes(
  app: FastifyInstance,
  db: DbContext
): void {
  app.get("/api/metrics", async () => {
    return getMetricDefinitions(db);
  });

  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; window?: string };
  }>("/api/metrics/:id", async (request, reply) => {
    const metric = getMetricDefinition(db, request.params.id);
    if (!metric) {
      return reply.status(404).send({ error: "Metric not found" });
    }

    const now = unixTimestamp();
    const defaultFrom = secondsAgo(86400);
    const from = request.query.from ? parseInt(request.query.from, 10) : defaultFrom;
    const to = request.query.to ? parseInt(request.query.to, 10) : now;
    const rangeSeconds = to - from;
    const window =
      request.query.window !== undefined
        ? parseInt(request.query.window, 10)
        : computeWindow(rangeSeconds);

    const samples = getSamples(db, request.params.id, from, to, window || undefined);

    return { metric, samples };
  });

  app.get("/api/metrics/categories", async () => {
    const categories = getCategories(db);
    return categories.map((c) => ({
      name: c.name,
      metricIds: c.metricIds,
    }));
  });
}
