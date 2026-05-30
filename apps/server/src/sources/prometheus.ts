import type { MetricsSourceConfig, MetricDef } from "@ledashboard/shared";
import type { MetricsAdapter, CollectedSample } from "./adapter";
import { unixTimestamp } from "@ledashboard/shared";

export class PrometheusAdapter implements MetricsAdapter {
  readonly sourceId: string;
  readonly type = "prometheus";
  private config: MetricsSourceConfig;

  constructor(config: MetricsSourceConfig) {
    this.config = config;
    this.sourceId = config.id;
  }

  async initialize(): Promise<MetricDef[]> {
    const defs: MetricDef[] = [];
    for (const mc of this.config.metrics ?? []) {
      const id = `${this.sourceId}:${mc.name}`;
      defs.push({
        id,
        sourceId: this.sourceId,
        name: mc.name,
        displayName: mc.name,
        category: mc.category,
        unit: mc.unit,
        labels: {},
      });
    }
    return defs;
  }

  async collect(): Promise<CollectedSample[]> {
    const response = await fetch(this.config.url, {
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Prometheus ${this.config.url} returned ${response.status}`
      );
    }

    const text = await response.text();
    return this.parseMetrics(text);
  }

  private parseMetrics(text: string): CollectedSample[] {
    const targetMetrics = new Set(
      (this.config.metrics ?? []).map((m) => m.name)
    );
    const samples: CollectedSample[] = [];
    const now = unixTimestamp();

    for (const line of text.split("\n")) {
      if (line.startsWith("#") || line.trim() === "") continue;

      const match = line.match(
        /^([a-zA-Z_:][a-zA-Z0-9_:]*)\{?(.*?)\}?\s+([0-9.eE+-]+)\s*(\d+)?$/
      );
      if (!match) continue;

      const [, metricName, labelsStr, valueStr] = match;

      if (!targetMetrics.has(metricName)) continue;

      const value = parseFloat(valueStr);
      if (isNaN(value)) continue;

      let metricId = `${this.sourceId}:${metricName}`;

      if (labelsStr) {
        const labels: Record<string, string> = {};
        const labelParts = labelsStr.split(",");
        for (const part of labelParts) {
          const eqIdx = part.indexOf("=");
          if (eqIdx === -1) continue;
          const key = part.slice(0, eqIdx).trim();
          const val = part.slice(eqIdx + 1).replace(/^"|"$/g, "");
          labels[key] = val;
        }
        if (Object.keys(labels).length > 0) {
          const labelSuffix = Object.entries(labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(",");
          metricId = `${this.sourceId}:${metricName}:${labelSuffix}`;
        }
      }

      samples.push({ metricId, ts: now, value });
    }

    return samples;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.auth?.token) {
      headers["Authorization"] = `Bearer ${this.config.auth.token}`;
    }
    if (this.config.auth?.username && this.config.auth?.password) {
      const encoded = Buffer.from(
        `${this.config.auth.username}:${this.config.auth.password}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }
    return headers;
  }
}
