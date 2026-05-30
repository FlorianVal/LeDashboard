import type { SourcesConfig, SourceStatus } from "@ledashboard/shared";
import type { DbContext } from "../db/client.js";
import { insertMetricDef, insertSamplesBatch, getMetricDefinitions } from "../db/queries.js";
import type { MetricsAdapter, CollectedSample } from "./adapter.js";
import { PrometheusAdapter } from "./prometheus.js";
import { HomeAssistantAdapter } from "./home-assistant.js";

export class SourceManager {
  private adapters: Map<string, MetricsAdapter> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private statuses: Map<string, SourceStatus> = new Map();
  private db: DbContext;
  private config: SourcesConfig;

  constructor(config: SourcesConfig, db: DbContext) {
    this.config = config;
    this.db = db;
  }

  async initialize(): Promise<void> {
    for (const source of this.config.sources) {
      let adapter: MetricsAdapter;

      switch (source.type) {
        case "prometheus":
          adapter = new PrometheusAdapter(source);
          break;
        case "home-assistant":
          adapter = new HomeAssistantAdapter(source);
          break;
        default:
          console.warn(`Unknown source type: ${source.type}`);
          continue;
      }

      this.adapters.set(source.id, adapter);

      try {
        const defs = await adapter.initialize();
        for (const def of defs) {
          insertMetricDef(this.db, {
            ...def,
            labelsJson: JSON.stringify(def.labels),
          });
        }
        console.log(
          `Initialized source "${source.name}" with ${defs.length} metrics`
        );
      } catch (err) {
        console.error(`Failed to initialize source "${source.name}":`, err);
      }

      this.statuses.set(source.id, {
        id: source.id,
        name: source.name,
        lastCollectedAt: null,
        lastError: null,
      });
    }
  }

  startCollection(): void {
    for (const source of this.config.sources) {
      const adapter = this.adapters.get(source.id);
      if (!adapter) continue;

      const tick = async () => {
        try {
          const samples = await adapter.collect();
          if (samples.length > 0) {
            const existingDefs = new Set(
              getMetricDefinitions(this.db).map((d) => d.id)
            );
            for (const sample of samples) {
              if (!existingDefs.has(sample.metricId)) {
                insertMetricDef(this.db, {
                  id: sample.metricId,
                  sourceId: source.id,
                  name: sample.metricId,
                  displayName: sample.metricId,
                  category: "auto",
                  unit: null,
                  labelsJson: "{}",
                });
                existingDefs.add(sample.metricId);
              }
            }
            insertSamplesBatch(this.db, samples);
          }
          this.statuses.set(source.id, {
            id: source.id,
            name: source.name,
            lastCollectedAt: new Date().toISOString(),
            lastError: null,
          });
          if (samples.length > 0) {
            console.log(
              `[${source.name}] Collected ${samples.length} samples`
            );
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          console.error(`[${source.name}] Collection error: ${message}`);
          this.statuses.set(source.id, {
            id: source.id,
            name: source.name,
            lastCollectedAt: this.statuses.get(source.id)?.lastCollectedAt ?? null,
            lastError: message,
          });
        }
      };

      tick();
      const interval = setInterval(tick, source.interval * 1000);
      this.intervals.set(source.id, interval);
    }
  }

  stopCollection(): void {
    for (const [id, interval] of this.intervals) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
  }

  getSourceStatuses(): SourceStatus[] {
    return Array.from(this.statuses.values());
  }
}
