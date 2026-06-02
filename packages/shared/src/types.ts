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

export type Sample = {
  ts: number;
  avg: number;
  min?: number;
  max?: number;
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
