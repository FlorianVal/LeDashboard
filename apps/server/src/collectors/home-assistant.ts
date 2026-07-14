import type { HomeAssistantConfig } from "../config.js";
import type {
  CollectionResult,
  CurrentValueInput,
  MetricSampleInput,
} from "./types.js";

const CLIMATE_ENTITY = "climate.air_conditioner";
const WEATHER_ENTITY = "weather.forecast_maison";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function requiredNumber(value: unknown, field: string): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric)) throw new Error(`${field} is not numeric`);
  return numeric;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is not a string`);
  }
  return value;
}

function isJson(response: Response): boolean {
  return response.headers.get("content-type")
    ?.toLowerCase()
    .includes("application/json") ?? false;
}

export class HomeAssistantCollector {
  readonly id = "home-assistant";
  readonly requiresSamples = true;
  readonly intervalSeconds: number;

  constructor(
    private readonly config: HomeAssistantConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.intervalSeconds = config.intervalSeconds;
  }

  private async fetchEntity(entityId: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(
      `${this.config.url.replace(/\/$/, "")}/states/${entityId}`,
      { headers: { authorization: `Bearer ${this.config.token}` } },
    );
    if (!response.ok) {
      throw new Error(`Home Assistant returned HTTP ${response.status}`);
    }
    if (!isJson(response)) {
      throw new Error("Home Assistant returned a non-JSON response");
    }
    return asRecord(await response.json());
  }

  async collect(): Promise<CollectionResult> {
    const [climate, weather] = await Promise.all([
      this.fetchEntity(CLIMATE_ENTITY),
      this.fetchEntity(WEATHER_ENTITY),
    ]);
    const climateAttributes = asRecord(climate.attributes);
    const weatherAttributes = asRecord(weather.attributes);
    const ts = Math.floor(Date.now() / 1000);

    const samples: MetricSampleInput[] = [
      {
        key: "comfort.indoor_temperature",
        ts,
        value: requiredNumber(
          climateAttributes.current_temperature,
          `${CLIMATE_ENTITY}.current_temperature`,
        ),
      },
      {
        key: "comfort.climate_target",
        ts,
        value: requiredNumber(
          climateAttributes.temperature,
          `${CLIMATE_ENTITY}.temperature`,
        ),
      },
      {
        key: "comfort.outdoor_temperature",
        ts,
        value: requiredNumber(
          weatherAttributes.temperature,
          `${WEATHER_ENTITY}.temperature`,
        ),
      },
    ];

    const optionalWeather: Array<{
      key: "weather.humidity" | "weather.pressure" | "weather.wind_speed";
      value: unknown;
    }> = [
      { key: "weather.humidity", value: weatherAttributes.humidity },
      { key: "weather.pressure", value: weatherAttributes.pressure },
      { key: "weather.wind_speed", value: weatherAttributes.wind_speed },
    ];
    for (const item of optionalWeather) {
      const value = optionalNumber(item.value);
      if (value !== undefined) samples.push({ key: item.key, ts, value });
    }

    const condition = requiredString(weather.state, `${WEATHER_ENTITY}.state`);
    const currentValues: CurrentValueInput[] =
      condition === "unknown" || condition === "unavailable"
        ? []
        : [{ key: "weather.condition", ts, textValue: condition }];

    return { samples, currentValues };
  }
}
