import type {
  ChartId,
  CurrentValueKey,
  DashboardChart,
  DashboardResponse,
  DashboardSeries,
  DashboardSupportingFacts,
  MetricKey,
  SourceFreshness,
} from "@ledashboard/shared";
import type { FastifyInstance } from "fastify";
import type { MetricsRepository } from "../db/repository.js";
import type { IncidentRepository } from "../services/incidents.js";
import type { SourceRepository } from "../services/source-manager.js";
import { resolutionForRange } from "../services/retention.js";

const DAY = 86_400;

type ChartDefinition = {
  id: ChartId;
  title: string;
  windowSeconds: number;
  series: readonly MetricKey[];
};

type MetricDefinition = {
  key: MetricKey;
  sourceId: string;
  displayName: string;
  unit: string;
  staleAfterSeconds: number;
};

export type CuratedMetricDefinition = MetricDefinition;

export const CHART_DEFINITIONS: readonly ChartDefinition[] = [
  {
    id: "comfort",
    title: "Confort",
    windowSeconds: DAY,
    series: [
      "comfort.indoor_temperature",
      "comfort.outdoor_temperature",
      "comfort.climate_target",
    ],
  },
  {
    id: "plants",
    title: "Plantes en retard",
    windowSeconds: 30 * DAY,
    series: ["plants.overdue_count"],
  },
  {
    id: "timelapseStorage",
    title: "Bibliothèque timelapse",
    windowSeconds: 180 * DAY,
    series: ["timelapse.library_bytes"],
  },
  {
    id: "macResources",
    title: "Ressources du Mac mini",
    windowSeconds: DAY,
    series: ["mac.cpu_percent", "mac.memory_percent", "mac.disk_percent"],
  },
  {
    id: "macNetwork",
    title: "Réseau du Mac mini",
    windowSeconds: DAY,
    series: ["mac.network_receive_bps", "mac.network_transmit_bps"],
  },
  {
    id: "nasStorage",
    title: "Stockage du NAS",
    windowSeconds: 180 * DAY,
    series: ["nas.storage_used_bytes", "nas.storage_total_bytes"],
  },
  {
    id: "availability",
    title: "Disponibilité",
    windowSeconds: 30 * DAY,
    series: ["services.available_percent"],
  },
] as const;

const CURRENT_VALUE_KEYS: readonly CurrentValueKey[] = [
  "weather.condition",
  "plants.last_watered_on",
  "timelapse.capture_last_success_at",
  "timelapse.capture_last_error_at",
  "timelapse.capture_last_error",
  "timelapse.capture_expected_interval_seconds",
];

export const SOURCE_IDS = [
  "home-assistant",
  "laplante",
  "letimelapse",
  "mac",
  "nas",
  "availability",
] as const;

function sourceFreshness(
  sourceId: string,
  staleAfterSeconds: number,
  sourceRepository: SourceRepository,
  nowMilliseconds: number,
): SourceFreshness {
  const persisted = sourceRepository.getSourceState(sourceId);
  if (persisted?.lastError !== null && persisted?.lastError !== undefined) {
    return {
      state: "error",
      lastSuccessAt: persisted.lastSuccessAt,
      lastError: `Collection failed for ${sourceId}`,
    };
  }

  const lastSuccessMilliseconds = persisted?.lastSuccessAt === null
    || persisted?.lastSuccessAt === undefined
    ? Number.NaN
    : Date.parse(persisted.lastSuccessAt);
  return {
    state: Number.isFinite(lastSuccessMilliseconds)
        && nowMilliseconds - lastSuccessMilliseconds < staleAfterSeconds * 1_000
      ? "fresh"
      : "stale",
    lastSuccessAt: persisted?.lastSuccessAt ?? null,
    lastError: null,
  };
}

function buildSources(
  definitions: ReadonlyMap<MetricKey, MetricDefinition>,
  sourceRepository: SourceRepository,
  nowMilliseconds: number,
): Record<string, SourceFreshness> {
  return Object.fromEntries(SOURCE_IDS.map((sourceId) => {
    const thresholds = Array.from(definitions.values())
      .filter((definition) => definition.sourceId === sourceId)
      .map((definition) => definition.staleAfterSeconds);
    const staleAfterSeconds = Math.min(...thresholds);
    return [sourceId, sourceFreshness(
      sourceId,
      staleAfterSeconds,
      sourceRepository,
      nowMilliseconds,
    )];
  }));
}

type NasDailyValue = { ts: number; value: number };

function nasCompleteDays(
  repository: MetricsRepository,
  nowSeconds: number,
): NasDailyValue[] {
  const startOfToday = Math.floor(nowSeconds / DAY) * DAY;
  const hourly = repository.getSeries(
    "nas.storage_used_bytes",
    startOfToday - 180 * DAY,
    startOfToday - 1,
    "1h",
  );
  const byDay = new Map<number, Map<number, number>>();
  for (const sample of hourly) {
    if (sample.ts % 3_600 !== 0) continue;
    const day = Math.floor(sample.ts / DAY) * DAY;
    const hour = Math.floor((sample.ts - day) / 3_600);
    const hours = byDay.get(day) ?? new Map<number, number>();
    hours.set(hour, sample.avg);
    byDay.set(day, hours);
  }

  return Array.from(byDay.entries())
    .filter(([, hours]) => hours.size === 24)
    .sort(([left], [right]) => left - right)
    .map(([ts, hours]) => ({
      ts,
      value: Array.from(hours.values()).reduce((sum, value) => sum + value, 0)
        / hours.size,
    }))
    .slice(-30);
}

function nasProjection(
  repository: MetricsRepository,
  nowSeconds: number,
) {
  const daily = nasCompleteDays(repository, nowSeconds);
  if (daily.length < 7) return null;

  const firstTimestamp = daily[0].ts;
  const xValues = daily.map((point) => (point.ts - firstTimestamp) / DAY);
  const meanX = xValues.reduce((sum, value) => sum + value, 0) / xValues.length;
  const meanY = daily.reduce((sum, point) => sum + point.value, 0) / daily.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < daily.length; index += 1) {
    numerator += (xValues[index] - meanX) * (daily[index].value - meanY);
    denominator += (xValues[index] - meanX) ** 2;
  }
  const dailyGrowth = numerator / denominator;
  if (!Number.isFinite(dailyGrowth) || dailyGrowth <= 0) return null;

  const latest = daily[daily.length - 1];
  const projected = latest.value + dailyGrowth * 30;
  return {
    key: "nas.storage_used_bytes" as const,
    kind: "projection" as const,
    name: "Projection à 30 jours",
    unit: "bytes",
    samples: [
      { ts: latest.ts, avg: latest.value, min: latest.value, max: latest.value },
      {
        ts: latest.ts + 30 * DAY,
        avg: projected,
        min: projected,
        max: projected,
      },
    ],
  };
}

function buildCharts(
  repository: MetricsRepository,
  definitions: ReadonlyMap<MetricKey, MetricDefinition>,
  nowSeconds: number,
): Record<ChartId, DashboardChart> {
  return Object.fromEntries(CHART_DEFINITIONS.map((chart) => {
    const from = nowSeconds - chart.windowSeconds;
    const resolution = resolutionForRange(chart.windowSeconds);
    const series: DashboardSeries[] = chart.series.map((key) => {
      const definition = definitions.get(key);
      if (!definition) throw new Error(`Missing metric definition: ${key}`);
      return {
        key,
        kind: "observed" as const,
        name: definition.displayName,
        unit: definition.unit,
        samples: repository.getSeries(key, from, nowSeconds, resolution),
      };
    });
    if (chart.id === "nasStorage") {
      const projection = nasProjection(repository, nowSeconds);
      if (projection !== null) series.push(projection);
    }
    return [chart.id, {
      id: chart.id,
      title: chart.title,
      windowSeconds: chart.windowSeconds,
      series,
    }];
  })) as Record<ChartId, DashboardChart>;
}

function buildFacts(repository: MetricsRepository) {
  return Object.fromEntries(CURRENT_VALUE_KEYS.flatMap((key) => {
    const value = repository.getCurrentValue(key);
    return value === null ? [] : [[key, value]];
  }));
}

function buildSupportingFacts(
  repository: MetricsRepository,
  definitions: ReadonlyMap<MetricKey, MetricDefinition>,
  nowSeconds: number,
): DashboardSupportingFacts {
  const numericFact = (key: MetricKey) => {
    const sample = repository.getLatestSample(key, nowSeconds);
    const definition = definitions.get(key);
    return sample === null || definition === undefined
      ? null
      : { ts: sample.ts, value: sample.avg, unit: definition.unit };
  };
  const condition = repository.getCurrentValue("weather.condition");
  return {
    weather: {
      humidity: numericFact("weather.humidity"),
      pressure: numericFact("weather.pressure"),
      windSpeed: numericFact("weather.wind_speed"),
      condition: condition?.textValue === null
          || condition?.textValue === undefined
        ? null
        : { ts: condition.ts, value: condition.textValue },
    },
  };
}

function applyCaptureFreshness(
  repository: MetricsRepository,
  sources: Record<string, SourceFreshness>,
  nowMilliseconds: number,
): "healthy" | "degraded" | "down" {
  const lastSuccess = repository
    .getCurrentValue("timelapse.capture_last_success_at")?.textValue;
  const lastError = repository
    .getCurrentValue("timelapse.capture_last_error_at")?.textValue;
  const expectedInterval = repository
    .getCurrentValue("timelapse.capture_expected_interval_seconds")
    ?.numericValue;
  const lastSuccessMilliseconds = lastSuccess === null || lastSuccess === undefined
    ? Number.NaN
    : Date.parse(lastSuccess);
  const lastErrorMilliseconds = lastError === null || lastError === undefined
    ? Number.NaN
    : Date.parse(lastError);
  if (Number.isFinite(lastErrorMilliseconds)
      && !Number.isFinite(lastSuccessMilliseconds)) {
    sources.letimelapse = {
      ...sources.letimelapse,
      state: "error",
      lastError: "Timelapse capture is down",
    };
    return "down";
  }
  if (!Number.isFinite(lastSuccessMilliseconds)
      || expectedInterval === null
      || expectedInterval === undefined
      || !Number.isFinite(expectedInterval)
      || expectedInterval <= 0) {
    return "healthy";
  }

  const missedMilliseconds = Math.max(0, nowMilliseconds - lastSuccessMilliseconds);
  const down = (Number.isFinite(lastErrorMilliseconds)
      && lastErrorMilliseconds > lastSuccessMilliseconds)
    || missedMilliseconds >= 6 * expectedInterval * 1_000;
  if (down) {
    sources.letimelapse = {
      ...sources.letimelapse,
      state: "error",
      lastError: "Timelapse capture is down",
    };
    return "down";
  }
  if (missedMilliseconds >= 3 * expectedInterval * 1_000) {
    if (sources.letimelapse.state === "fresh") {
      sources.letimelapse = {
        ...sources.letimelapse,
        state: "stale",
      };
    }
    return "degraded";
  }
  return "healthy";
}

export type DashboardRouteDependencies = {
  repository: MetricsRepository;
  sourceRepository: SourceRepository;
  incidentRepository: IncidentRepository;
  metricDefinitions: ReadonlyMap<MetricKey, MetricDefinition>;
  now: () => Date;
};

export function registerDashboardRoutes(
  app: FastifyInstance,
  dependencies: DashboardRouteDependencies,
): void {
  app.get("/api/dashboard", async (): Promise<DashboardResponse> => {
    const now = dependencies.now();
    const nowMilliseconds = now.getTime();
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const sources = buildSources(
      dependencies.metricDefinitions,
      dependencies.sourceRepository,
      nowMilliseconds,
    );
    const captureState = applyCaptureFreshness(
      dependencies.repository,
      sources,
      nowMilliseconds,
    );
    const activeIncidents = dependencies.incidentRepository.getActiveIncidents();
    const overallState = activeIncidents.length > 0 || captureState === "down"
      ? "down"
      : captureState === "degraded"
          || Object.values(sources).some(({ state }) => state !== "fresh")
        ? "degraded"
        : "healthy";

    return {
      generatedAt: now.toISOString(),
      overallState,
      charts: buildCharts(
        dependencies.repository,
        dependencies.metricDefinitions,
        nowSeconds,
      ),
      facts: buildFacts(dependencies.repository),
      supportingFacts: buildSupportingFacts(
        dependencies.repository,
        dependencies.metricDefinitions,
        nowSeconds,
      ),
      sources,
      activeIncidents,
    };
  });

  app.get("/api/sources", async () => {
    const nowMilliseconds = dependencies.now().getTime();
    return buildSources(
      dependencies.metricDefinitions,
      dependencies.sourceRepository,
      nowMilliseconds,
    );
  });
}
