import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { Agent, createServer, type RequestOptions } from "node:https";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceConfig } from "../src/config.js";
import {
  AvailabilityCollector,
  checkAvailability,
} from "../src/collectors/availability.js";
import type { IncidentRepository } from "../src/services/incidents.js";

const baseService: ServiceConfig = {
  id: "couchdb",
  name: "CouchDB",
  url: "https://couchdb.test/",
  expectedStatuses: [401],
  latencyThresholdMs: 1_000,
  tlsInsecure: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function repositorySpy() {
  return {
    applyCheck: vi.fn(),
  } as unknown as IncidentRepository;
}

describe("checkAvailability", () => {
  it("uses the production HTTPS transport only when insecure TLS is opted in", async () => {
    const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const server = createServer({
      cert: readFileSync(new URL("./fixtures/localhost-cert.pem", import.meta.url)),
      key: readFileSync(new URL("./fixtures/localhost-key.pem", import.meta.url)),
    }, (_request, response) => {
      response.writeHead(401);
      response.end();
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    try {
      const address = server.address() as AddressInfo;
      const service = {
        ...baseService,
        url: `https://127.0.0.1:${address.port}/`,
      };

      await expect(checkAvailability({ ...service, tlsInsecure: true }, {
        timeoutMs: 1_000,
      })).resolves.toMatchObject({ available: true, error: null });

      await expect(checkAvailability(service, {
        timeoutMs: 1_000,
      })).resolves.toEqual({
        available: false,
        slow: false,
        latencyMs: null,
        error: "request_failed",
      });
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(originalTlsSetting);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("uses an unverified request-local agent only for the opted-in service", async () => {
    const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const insecureRequest = vi.fn((_url, options: RequestOptions, onResponse) => {
      const response = new PassThrough() as PassThrough & { statusCode: number };
      response.statusCode = 401;
      queueMicrotask(() => {
        onResponse(response);
        response.end();
      });
      const request = new EventEmitter() as EventEmitter & {
        end: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
      };
      request.end = vi.fn();
      request.destroy = vi.fn();
      return request;
    });
    const defaultFetch = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(checkAvailability({ ...baseService, tlsInsecure: true }, {
      timeoutMs: 50,
      fetchImpl: defaultFetch,
      httpsRequestImpl: insecureRequest,
      monotonicNow: () => 10,
    })).resolves.toMatchObject({ available: true, error: null });

    const agent = insecureRequest.mock.calls[0]?.[1].agent;
    expect(agent).toBeInstanceOf(Agent);
    expect((agent as Agent).options.rejectUnauthorized).toBe(false);
    expect(defaultFetch).not.toHaveBeenCalled();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(originalTlsSetting);

    await expect(checkAvailability({
      ...baseService,
      id: "plex",
      url: "https://plex.test/identity",
      expectedStatuses: [200],
      tlsInsecure: false,
    }, {
      timeoutMs: 50,
      fetchImpl: defaultFetch,
      httpsRequestImpl: insecureRequest,
      monotonicNow: () => 10,
    })).resolves.toMatchObject({ available: true, error: null });

    expect(defaultFetch).toHaveBeenCalledTimes(1);
    expect(insecureRequest).toHaveBeenCalledTimes(1);
  });

  it("accepts only a configured expected HTTP status without reading its body", async () => {
    const text = vi.fn(async () => "auth-token-from-body");
    const fetchImpl = vi.fn(async () => {
      const response = new Response(null, { status: 401 });
      Object.defineProperty(response, "text", { value: text });
      return response;
    });

    await expect(checkAvailability(baseService, {
      timeoutMs: 50,
      fetchImpl,
      monotonicNow: vi.fn()
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(35),
    })).resolves.toEqual({
      available: true,
      slow: false,
      latencyMs: 25,
      error: null,
    });
    expect(text).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("classifies an unexpected status generically without exposing status or body", async () => {
    const result = await checkAvailability(baseService, {
      timeoutMs: 50,
      fetchImpl: async () => new Response("password=body-secret", { status: 503 }),
      monotonicNow: vi.fn()
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(15),
    });

    expect(result).toEqual({
      available: false,
      slow: false,
      latencyMs: 5,
      error: "unexpected_status",
    });
    expect(JSON.stringify(result)).not.toContain("503");
    expect(JSON.stringify(result)).not.toContain("body-secret");
  });

  it("bounds a hanging request with AbortSignal.timeout", async () => {
    const fetchImpl: typeof fetch = async (_url, init) =>
      await new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("missing timeout signal");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });

    await expect(checkAvailability(baseService, {
      timeoutMs: 5,
      fetchImpl,
    })).resolves.toMatchObject({
      available: false,
      slow: false,
      latencyMs: null,
      error: "timeout",
    });
  });

  it("sanitizes network and TLS failures instead of retaining their messages", async () => {
    for (const message of [
      "connect ECONNREFUSED https://user:password@private.test",
      "certificate failure for api-key-secret",
    ]) {
      const result = await checkAvailability(baseService, {
        timeoutMs: 50,
        fetchImpl: async () => { throw new Error(message); },
      });
      expect(result.error).toBe("request_failed");
      expect(JSON.stringify(result)).not.toContain(message);
    }
  });

  it("marks a response above the latency threshold slow but available", async () => {
    const result = await checkAvailability(baseService, {
      timeoutMs: 2_000,
      fetchImpl: async () => new Response(null, { status: 401 }),
      monotonicNow: vi.fn()
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(1_250),
    });

    expect(result).toEqual({
      available: true,
      slow: true,
      latencyMs: 1_150,
      error: null,
    });
  });
});

describe("AvailabilityCollector", () => {
  it("persists each result and emits the percentage of checked services", async () => {
    const repository = repositorySpy();
    const services: ServiceConfig[] = [
      baseService,
      {
        ...baseService,
        id: "plex",
        name: "Plex",
        url: "http://plex.test/identity",
        expectedStatuses: [200],
      },
    ];
    const collector = new AvailabilityCollector(services, repository, {
      timeoutMs: 100,
      fetchImpl: async (url) => new Response(null, {
        status: String(url).includes("couchdb") ? 401 : 503,
      }),
      now: () => new Date("2026-07-14T12:00:00.000Z"),
      monotonicNow: () => 10,
    });

    await expect(collector.collect()).resolves.toEqual({
      samples: [{
        key: "services.available_percent",
        ts: 1_784_030_400,
        value: 50,
      }],
      currentValues: [],
    });
    expect(collector.id).toBe("availability");
    expect(collector.intervalSeconds).toBe(60);
    expect(collector.requiresSamples).toBe(false);
    expect(repository.applyCheck).toHaveBeenCalledTimes(2);
    expect(repository.applyCheck).toHaveBeenNthCalledWith(
      1,
      { id: "couchdb", name: "CouchDB" },
      expect.objectContaining({ available: true }),
      "2026-07-14T12:00:00.000Z",
    );
    expect(repository.applyCheck).toHaveBeenNthCalledWith(
      2,
      { id: "plex", name: "Plex" },
      expect.objectContaining({ available: false, error: "unexpected_status" }),
      "2026-07-14T12:00:00.000Z",
    );
  });

  it("emits no fabricated zero sample when no service was checked", async () => {
    const repository = repositorySpy();
    const fetchImpl = vi.fn<typeof fetch>();
    const collector = new AvailabilityCollector([], repository, {
      fetchImpl,
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    });

    await expect(collector.collect()).resolves.toEqual({
      samples: [],
      currentValues: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repository.applyCheck).not.toHaveBeenCalled();
  });
});
