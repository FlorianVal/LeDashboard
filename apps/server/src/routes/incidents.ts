import type { FastifyInstance } from "fastify";
import type { IncidentRepository } from "../services/incidents.js";
import { parseTimeRange } from "./series.js";

const DAY = 86_400;

export function registerIncidentRoutes(
  app: FastifyInstance,
  incidentRepository: IncidentRepository,
  now: () => Date,
): void {
  app.get<{
    Querystring: { from?: string; to?: string };
  }>("/api/incidents", async (request, reply) => {
    const nowSeconds = Math.floor(now().getTime() / 1_000);
    const range = parseTimeRange(request.query, 180 * DAY, nowSeconds);
    if (range === null) {
      return reply.status(400).send({ error: "Invalid time range" });
    }
    return incidentRepository.getIncidents().filter((incident) => {
      const startedAt = Date.parse(incident.startedAt) / 1_000;
      const endedAt = incident.endedAt === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(incident.endedAt) / 1_000;
      return startedAt <= range.to && endedAt >= range.from;
    });
  });
}
