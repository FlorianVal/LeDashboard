import { METRIC_KEYS, type MetricKey } from "@ledashboard/shared";
import type { FastifyInstance } from "fastify";
import type { MetricsRepository } from "../db/repository.js";
import { resolutionForRange } from "../services/retention.js";
import {
  CHART_DEFINITIONS,
  type CuratedMetricDefinition,
} from "./dashboard.js";

const DAY = 86_400;
const MAX_RANGE_SECONDS = 180 * DAY;
const METRIC_KEY_SET = new Set<string>(METRIC_KEYS);

type TimeRange = { from: number; to: number };

function epoch(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export function parseTimeRange(
  query: { from?: string; to?: string },
  defaultWindowSeconds: number,
  nowSeconds: number,
): TimeRange | null {
  const to = epoch(query.to) ?? nowSeconds;
  const from = epoch(query.from) ?? to - defaultWindowSeconds;
  if (!Number.isFinite(from)
      || !Number.isFinite(to)
      || from < 0
      || to < 0
      || from >= to
      || to - from > MAX_RANGE_SECONDS) {
    return null;
  }
  return { from, to };
}

function defaultWindowForKey(key: MetricKey): number {
  return CHART_DEFINITIONS.find((chart) => chart.series.includes(key))
    ?.windowSeconds ?? DAY;
}

export type SeriesRouteDependencies = {
  repository: MetricsRepository;
  metricDefinitions: ReadonlyMap<MetricKey, CuratedMetricDefinition>;
  now: () => Date;
};

export function registerSeriesRoutes(
  app: FastifyInstance,
  dependencies: SeriesRouteDependencies,
): void {
  app.get<{
    Params: { key: string };
    Querystring: { from?: string; to?: string };
  }>("/api/series/:key", async (request, reply) => {
    if (!METRIC_KEY_SET.has(request.params.key)) {
      return reply.status(404).send({ error: "Series not found" });
    }
    const key = request.params.key as MetricKey;
    const nowSeconds = Math.floor(dependencies.now().getTime() / 1_000);
    const range = parseTimeRange(
      request.query,
      defaultWindowForKey(key),
      nowSeconds,
    );
    if (range === null) {
      return reply.status(400).send({ error: "Invalid time range" });
    }
    const definition = dependencies.metricDefinitions.get(key);
    if (!definition) {
      return reply.status(404).send({ error: "Series not found" });
    }
    const resolution = resolutionForRange(range.to - range.from);
    return {
      key,
      name: definition.displayName,
      unit: definition.unit,
      from: range.from,
      to: range.to,
      resolution,
      samples: dependencies.repository.getSeries(
        key,
        range.from,
        range.to,
        resolution,
      ),
    };
  });
}
