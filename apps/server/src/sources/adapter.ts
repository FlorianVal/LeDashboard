import type { MetricDef } from "@ledashboard/shared";

export type CollectedSample = {
  metricId: string;
  ts: number;
  value: number;
  labels?: Record<string, string>;
};

export interface MetricsAdapter {
  readonly sourceId: string;
  readonly type: string;
  initialize(): Promise<MetricDef[]>;
  collect(): Promise<CollectedSample[]>;
}
