import type { MetricsSourceConfig, MetricDef } from "@ledashboard/shared";
import type { MetricsAdapter, CollectedSample } from "./adapter.js";
import { unixTimestamp } from "@ledashboard/shared";

export class HomeAssistantAdapter implements MetricsAdapter {
  readonly sourceId: string;
  readonly type = "home-assistant";
  private config: MetricsSourceConfig;

  constructor(config: MetricsSourceConfig) {
    this.config = config;
    this.sourceId = config.id;
  }

  async initialize(): Promise<MetricDef[]> {
    const defs: MetricDef[] = [];
    for (const sensor of this.config.sensors ?? []) {
      const id = sensor.attribute
        ? `${this.sourceId}:${sensor.entity_id}:${sensor.attribute}`
        : `${this.sourceId}:${sensor.entity_id}`;
      defs.push({
        id,
        sourceId: this.sourceId,
        name: sensor.entity_id,
        displayName: sensor.name,
        category: sensor.category,
        unit: sensor.unit,
        labels: {},
      });
    }
    return defs;
  }

  async collect(): Promise<CollectedSample[]> {
    const samples: CollectedSample[] = [];
    const now = unixTimestamp();

    for (const sensor of this.config.sensors ?? []) {
      try {
        const url = `${this.config.url}/states/${sensor.entity_id}`;
        const response = await fetch(url, {
          headers: this.authHeaders(),
        });

        if (!response.ok) {
          console.warn(
            `HA sensor ${sensor.entity_id} returned ${response.status}`
          );
          continue;
        }

        const data = (await response.json()) as {
          state: string;
          attributes: Record<string, unknown>;
          last_updated: string;
        };
        const rawValue = sensor.attribute
          ? data.attributes[sensor.attribute]
          : data.state;
        const value = typeof rawValue === "number" ? rawValue : parseFloat(String(rawValue));
        if (isNaN(value)) continue;

        const metricId = sensor.attribute
          ? `${this.sourceId}:${sensor.entity_id}:${sensor.attribute}`
          : `${this.sourceId}:${sensor.entity_id}`;
        samples.push({ metricId, ts: now, value });
      } catch (err) {
        console.warn(`Failed to collect HA sensor ${sensor.entity_id}:`, err);
      }
    }

    return samples;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.auth?.token) {
      headers["Authorization"] = `Bearer ${this.config.auth.token}`;
    }
    return headers;
  }
}
