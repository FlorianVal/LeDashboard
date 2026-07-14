import { z } from "zod";
import type { EndpointConfig } from "../config.js";
import type {
  CollectionResult,
  CurrentValueInput,
} from "./types.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestampSchema = z.string().datetime({ offset: true });

const laPlanteSummarySchema = z.object({
  overdueCount: z.number().int().nonnegative(),
  lastWateredOn: isoDateSchema.nullable(),
}).strict();

const captureSchema = z.object({
  lastSuccessAt: timestampSchema.nullable(),
  lastErrorAt: timestampSchema.nullable(),
  lastError: z.string().nullable(),
  expectedIntervalSeconds: z.number().int().positive(),
}).strict();

const timelapseStatusSchema = z.object({
  capture: captureSchema,
  library: z.object({
    totalBytes: z.number().int().nonnegative(),
    videoCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();

function isJson(response: Response): boolean {
  return response.headers.get("content-type")
    ?.toLowerCase()
    .includes("application/json") ?? false;
}

async function fetchJson(
  sourceName: string,
  url: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${sourceName} returned HTTP ${response.status}`);
  }
  if (!isJson(response)) {
    throw new Error(`${sourceName} returned a non-JSON response`);
  }
  return response.json();
}

export class LaPlanteCollector {
  readonly id = "laplante";
  readonly requiresSamples = true;
  readonly intervalSeconds: number;

  constructor(
    private readonly config: EndpointConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.intervalSeconds = config.intervalSeconds;
  }

  async collect(): Promise<CollectionResult> {
    const summary = laPlanteSummarySchema.parse(
      await fetchJson("LaPlante", this.config.url, this.fetchImpl),
    );
    const ts = Math.floor(Date.now() / 1000);
    return {
      samples: [{ key: "plants.overdue_count", ts, value: summary.overdueCount }],
      currentValues: summary.lastWateredOn === null
        ? []
        : [{
            key: "plants.last_watered_on",
            ts,
            textValue: summary.lastWateredOn,
          }],
    };
  }
}

export class LeTimelapseCollector {
  readonly id = "letimelapse";
  readonly requiresSamples = true;
  readonly intervalSeconds: number;

  constructor(
    private readonly config: EndpointConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.intervalSeconds = config.intervalSeconds;
  }

  async collect(): Promise<CollectionResult> {
    const status = timelapseStatusSchema.parse(
      await fetchJson("LeTimelapse", this.config.url, this.fetchImpl),
    );
    const ts = Math.floor(Date.now() / 1000);
    const currentValues: CurrentValueInput[] = [];

    if (status.capture.lastSuccessAt !== null) {
      currentValues.push({
        key: "timelapse.capture_last_success_at",
        ts,
        textValue: status.capture.lastSuccessAt,
      });
    }
    if (status.capture.lastErrorAt !== null) {
      currentValues.push({
        key: "timelapse.capture_last_error_at",
        ts,
        textValue: status.capture.lastErrorAt,
      });
    }
    if (status.capture.lastError !== null) {
      currentValues.push({
        key: "timelapse.capture_last_error",
        ts,
        textValue: status.capture.lastError,
      });
    }
    currentValues.push({
      key: "timelapse.capture_expected_interval_seconds",
      ts,
      numericValue: status.capture.expectedIntervalSeconds,
    });

    return {
      samples: [{
        key: "timelapse.library_bytes",
        ts,
        value: status.library.totalBytes,
      }],
      currentValues,
    };
  }
}
