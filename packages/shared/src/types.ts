export const METRIC_KEYS = [
  "comfort.indoor_temperature",
  "comfort.outdoor_temperature",
  "comfort.climate_target",
  "weather.humidity",
  "weather.pressure",
  "weather.wind_speed",
  "plants.overdue_count",
  "timelapse.library_bytes",
  "mac.cpu_percent",
  "mac.memory_percent",
  "mac.disk_percent",
  "mac.network_receive_bps",
  "mac.network_transmit_bps",
  "nas.storage_used_bytes",
  "nas.storage_total_bytes",
  "services.available_percent",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type CurrentValueKey =
  | "weather.condition"
  | "plants.last_watered_on"
  | "timelapse.capture_last_success_at"
  | "timelapse.capture_last_error_at"
  | "timelapse.capture_last_error"
  | "timelapse.capture_expected_interval_seconds";

export type ChartId =
  | "comfort"
  | "plants"
  | "timelapseStorage"
  | "macResources"
  | "macNetwork"
  | "nasStorage"
  | "availability";

export type DashboardSeries = {
  key: MetricKey;
  name: string;
  unit: string;
  samples: Sample[];
};

export type DashboardChart = {
  id: ChartId;
  title: string;
  windowSeconds: number;
  series: DashboardSeries[];
};

export type DashboardResponse = {
  generatedAt: string;
  overallState: "healthy" | "degraded" | "down";
  charts: Record<ChartId, DashboardChart>;
  facts: Partial<Record<CurrentValueKey, CurrentValue>>;
  sources: Record<string, SourceFreshness>;
  activeIncidents: Incident[];
};

export type Sample = { ts: number; avg: number; min: number; max: number };
export type CurrentValue = {
  key: CurrentValueKey;
  ts: number;
  numericValue: number | null;
  textValue: string | null;
};
export type Incident = {
  id: number;
  serviceId: string;
  startedAt: string;
  endedAt: string | null;
  lastError: string | null;
};
export type SourceFreshness = {
  state: "fresh" | "stale" | "error";
  lastSuccessAt: string | null;
  lastError: string | null;
};

// Legacy contracts stay exported until the v1 compatibility routes are removed.
export type ISODateString = string;

export type MetricsSourceType = "prometheus" | "home-assistant";

export type MetricsSourceConfig = {
  id: string;
  name: string;
  type: MetricsSourceType;
  url: string;
  interval: number;
  auth?: {
    token?: string;
    username?: string;
    password?: string;
  };
  sensors?: SensorConfig[];
  metrics?: MetricConfig[];
};

export type SensorConfig = {
  entity_id: string;
  name: string;
  category: string;
  unit: string;
  attribute?: string;
  displayName?: string;
  group?: string;
};

export type MetricConfig = {
  name: string;
  category: string;
  unit: string;
  displayName?: string;
  group?: string;
};

export type SourcesConfig = {
  sources: MetricsSourceConfig[];
};

export type MetricDef = {
  id: string;
  sourceId: string;
  name: string;
  displayName: string;
  category: string;
  unit: string | null;
  labels: Record<string, string>;
};

export type MetricResponse = {
  metric: MetricDef;
  samples: Sample[];
};

export type MetricsQuery = {
  from?: number;
  to?: number;
  window?: number;
};

export type CategoryInfo = {
  name: string;
  metricIds: string[];
};

export type SourceStatus = {
  id: string;
  name: string;
  lastCollectedAt: string | null;
  lastError: string | null;
};
