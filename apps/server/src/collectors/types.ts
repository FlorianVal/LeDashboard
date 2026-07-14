import type { CurrentValueKey, MetricKey } from "@ledashboard/shared";

export type MetricSampleInput = {
  key: MetricKey;
  ts: number;
  value: number;
};

export type CurrentValueInput = {
  key: CurrentValueKey;
  ts: number;
  numericValue?: number;
  textValue?: string;
};

export type CollectionResult = {
  samples: MetricSampleInput[];
  currentValues: CurrentValueInput[];
};

export interface Collector {
  readonly id: string;
  readonly intervalSeconds: number;
  readonly requiresSamples: boolean;
  collect(): Promise<CollectionResult>;
}
