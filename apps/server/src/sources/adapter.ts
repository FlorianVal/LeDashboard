import type { MetricDef } from "@ledashboard/shared";

export type CollectedSample = {
  metricId: string;
  ts: number;
  value: number;
};

export interface MetricsAdapter {
  readonly sourceId: string;
  readonly type: string;
  initialize(): Promise<MetricDef[]>;
  collect(): Promise<CollectedSample[]>;
}
