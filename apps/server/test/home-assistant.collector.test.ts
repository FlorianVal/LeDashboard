import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistantConfig } from "../src/config.js";
import { HomeAssistantCollector } from "../src/collectors/home-assistant.js";

const config: HomeAssistantConfig = {
  url: "http://home-assistant.test/api",
  token: "ha-secret-token",
  intervalSeconds: 300,
};

type StateFixture = {
  climate: unknown;
  weather: unknown;
};

function fetchFixture(fixture: StateFixture) {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization") });
    const body = url.endsWith("/climate.air_conditioner")
      ? fixture.climate
      : fixture.weather;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

function validFixture(): StateFixture {
  return {
    climate: {
      state: "off",
      attributes: { current_temperature: 28.5, temperature: "25" },
    },
    weather: {
      state: "partlycloudy",
      attributes: {
        temperature: "18.25",
        humidity: 42,
        pressure: "1014.2",
        wind_speed: 7.5,
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HomeAssistantCollector", () => {
  it("fetches configured climate and weather facts with bearer authentication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    const fixture = fetchFixture(validFixture());
    const collector = new HomeAssistantCollector(config, fixture.fetchImpl);

    const result = await collector.collect();

    expect(collector.id).toBe("home-assistant");
    expect(collector.intervalSeconds).toBe(300);
    expect(collector.requiresSamples).toBe(true);
    expect(fixture.requests).toEqual([
      {
        url: "http://home-assistant.test/api/states/climate.air_conditioner",
        authorization: "Bearer ha-secret-token",
      },
      {
        url: "http://home-assistant.test/api/states/weather.forecast_maison",
        authorization: "Bearer ha-secret-token",
      },
    ]);
    expect(result).toEqual({
      samples: [
        { key: "comfort.indoor_temperature", ts: 1_784_030_400, value: 28.5 },
        { key: "comfort.climate_target", ts: 1_784_030_400, value: 25 },
        { key: "comfort.outdoor_temperature", ts: 1_784_030_400, value: 18.25 },
        { key: "weather.humidity", ts: 1_784_030_400, value: 42 },
        { key: "weather.pressure", ts: 1_784_030_400, value: 1014.2 },
        { key: "weather.wind_speed", ts: 1_784_030_400, value: 7.5 },
      ],
      currentValues: [
        { key: "weather.condition", ts: 1_784_030_400, textValue: "partlycloudy" },
      ],
    });
  });

  it("requires all three comfort temperatures", async () => {
    const fixture = validFixture();
    fixture.weather = {
      state: "partlycloudy",
      attributes: { humidity: 42 },
    };
    const collector = new HomeAssistantCollector(
      config,
      fetchFixture(fixture).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(
      "weather.forecast_maison.temperature is not numeric",
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["unavailable", "unavailable"],
    ["empty", ""],
  ])("rejects a %s required climate temperature", async (_label, value) => {
    const fixture = validFixture();
    fixture.climate = {
      state: "off",
      attributes: { current_temperature: value, temperature: 25 },
    };
    const collector = new HomeAssistantCollector(
      config,
      fetchFixture(fixture).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(
      "climate.air_conditioner.current_temperature is not numeric",
    );
  });

  it("omits unavailable optional weather values instead of coercing them to zero", async () => {
    const fixture = validFixture();
    fixture.weather = {
      state: "rainy",
      attributes: {
        temperature: 17,
        humidity: null,
        pressure: "unavailable",
        wind_speed: "",
      },
    };
    const collector = new HomeAssistantCollector(
      config,
      fetchFixture(fixture).fetchImpl,
    );

    const result = await collector.collect();

    expect(result.samples.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "comfort.indoor_temperature", value: 28.5 },
      { key: "comfort.climate_target", value: 25 },
      { key: "comfort.outdoor_temperature", value: 17 },
    ]);
  });

  it("omits an unavailable weather condition instead of storing it as a fact", async () => {
    const fixture = validFixture();
    fixture.weather = {
      state: "unavailable",
      attributes: { temperature: 17 },
    };
    const collector = new HomeAssistantCollector(
      config,
      fetchFixture(fixture).fetchImpl,
    );

    const result = await collector.collect();

    expect(result.currentValues).toEqual([{
      key: "weather.condition",
      ts: expect.any(Number),
      textValue: null,
    }]);
  });

  it("rejects a successful weather response without its condition", async () => {
    const fixture = validFixture();
    fixture.weather = { attributes: { temperature: 18 } };
    const collector = new HomeAssistantCollector(
      config,
      fetchFixture(fixture).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(
      "weather.forecast_maison.state is not a string",
    );
  });

  it("rejects non-successful entity responses", async () => {
    const fetchImpl: typeof fetch = async () => new Response("unauthorized", {
      status: 401,
    });
    const collector = new HomeAssistantCollector(config, fetchImpl);

    const error = await collector.collect().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Home Assistant returned HTTP 401");
    expect((error as Error).message).not.toContain(config.token);
  });

  it("rejects successful non-JSON entity responses", async () => {
    const fetchImpl: typeof fetch = async () => new Response("not json", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    const collector = new HomeAssistantCollector(config, fetchImpl);

    await expect(collector.collect()).rejects.toThrow(
      "Home Assistant returned a non-JSON response",
    );
  });

  it("rejects malformed JSON without exposing the body, token, or URL", async () => {
    const bodySecret = "ha-malformed-body-secret";
    const fetchImpl: typeof fetch = async () => new Response(
      `{"credential":"${bodySecret}"`,
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
    const collector = new HomeAssistantCollector(config, fetchImpl);

    const error = await collector.collect().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message)
      .toBe("Home Assistant returned malformed JSON");
    expect((error as Error).message).not.toContain(bodySecret);
    expect((error as Error).message).not.toContain(config.token);
    expect((error as Error).message).not.toContain(config.url);
  });

  it("bounds a transport that never settles with a safe timeout category", async () => {
    const fetchImpl: typeof fetch = () => new Promise<Response>(() => undefined);
    const collector = new HomeAssistantCollector(config, fetchImpl, 5);

    await expect(collector.collect()).rejects.toThrow("Home Assistant request timed out");
  });

  it("keeps the timeout active while a JSON response body stalls", async () => {
    const fetchImpl: typeof fetch = async () => {
      const response = Response.json({});
      Object.defineProperty(response, "json", {
        value: () => new Promise<unknown>(() => undefined),
      });
      return response;
    };
    const collector = new HomeAssistantCollector(config, fetchImpl, 5);
    const guard = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("collector stayed pending")), 100);
    });

    await expect(Promise.race([collector.collect(), guard]))
      .rejects.toThrow("Home Assistant request timed out");
  });
});
