import type { MetricsSourceConfig, MetricDef } from "@ledashboard/shared";
import type { MetricsAdapter, CollectedSample } from "./adapter.js";
import { unixTimestamp } from "@ledashboard/shared";

const DISPLAY_NAME_MAP: Record<string, string> = {
  node_load1: "Charge CPU (1 min)",
  node_load5: "Charge CPU (5 min)",
  node_load15: "Charge CPU (15 min)",
  node_memory_MemTotal_bytes: "Mémoire Totale",
  node_memory_MemAvailable_bytes: "Mémoire Disponible",
  node_memory_Active_bytes: "Mémoire Active",
  node_network_receive_bytes_total: "Réception Réseau",
  node_network_transmit_bytes_total: "Émission Réseau",
};

export class PrometheusAdapter implements MetricsAdapter {
  readonly sourceId: string;
  readonly type = "prometheus";
  private config: MetricsSourceConfig;

  constructor(config: MetricsSourceConfig) {
    this.config = config;
    this.sourceId = config.id;
  }

  async initialize(): Promise<MetricDef[]> {
    // Les définitions Prometheus sont créées dynamiquement pendant la collecte,
    // car les labels (ex: device=eth0) ne sont connus qu'au moment du parsing.
    // Retourner des définitions statiques sans labels créerait des orphelines
    // qui ne recevraient jamais d'échantillons.
    return [];
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
      let labels: Record<string, string> = {};

      if (labelsStr) {
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

      samples.push({ metricId, ts: now, value, labels });
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
