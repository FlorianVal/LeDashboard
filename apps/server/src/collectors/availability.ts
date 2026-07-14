import {
  Agent,
  request as httpsRequest,
  type RequestOptions,
} from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { ServiceConfig } from "../config.js";
import type { CollectionResult, Collector } from "./types.js";
import {
  IncidentRepository,
  type ServiceCheckResult,
} from "../services/incidents.js";

export type AvailabilityCheckOptions = {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  httpsRequestImpl?: HttpsRequest;
  monotonicNow?: () => number;
};

type HttpsRequest = (
  url: string | URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => Pick<ClientRequest, "on" | "end">;

function fetchWithInsecureTls(
  url: string,
  signal: AbortSignal,
  requestImpl: HttpsRequest,
): Promise<Pick<Response, "status">> {
  return new Promise((resolve, reject) => {
    const agent = new Agent({ rejectUnauthorized: false });
    const request = requestImpl(url, { agent, signal }, (response) => {
      response.once("end", () => agent.destroy());
      response.once("error", () => agent.destroy());
      response.resume();
      resolve({ status: response.statusCode ?? 0 });
    });
    request.on("error", (cause: Error) => {
      agent.destroy();
      reject(cause);
    });
    request.end();
  });
}

export type AvailabilityCollectorOptions = {
  timeoutMs?: number;
  intervalSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  monotonicNow?: () => number;
};

export async function checkAvailability(
  service: ServiceConfig,
  options: AvailabilityCheckOptions,
): Promise<ServiceCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const signal = AbortSignal.timeout(options.timeoutMs);
  const startedAt = monotonicNow();

  try {
    const response = service.tlsInsecure
      ? await fetchWithInsecureTls(
        service.url,
        signal,
        options.httpsRequestImpl ?? httpsRequest,
      )
      : await fetchImpl(service.url, { signal });
    const latencyMs = Math.max(0, monotonicNow() - startedAt);
    if (!service.expectedStatuses.includes(response.status)) {
      return {
        available: false,
        slow: false,
        latencyMs,
        error: "unexpected_status",
      };
    }
    return {
      available: true,
      slow: latencyMs > service.latencyThresholdMs,
      latencyMs,
      error: null,
    };
  } catch (cause) {
    const timeout = signal.aborted
      || (cause instanceof Error && cause.name === "TimeoutError");
    return {
      available: false,
      slow: false,
      latencyMs: null,
      error: timeout ? "timeout" : "request_failed",
    };
  }
}

export class AvailabilityCollector implements Collector {
  readonly id = "availability";
  readonly requiresSamples = false;
  readonly intervalSeconds: number;

  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;

  constructor(
    private readonly services: readonly ServiceConfig[],
    private readonly repository: IncidentRepository,
    options: AvailabilityCollectorOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.intervalSeconds = options.intervalSeconds ?? 60;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  async collect(): Promise<CollectionResult> {
    const checkedAt = this.now();
    const checkedAtIso = checkedAt.toISOString();
    const checks = await Promise.all(this.services.map(async (service) => ({
      service,
      result: await checkAvailability(service, {
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
        monotonicNow: this.monotonicNow,
      }),
    })));

    for (const check of checks) {
      this.repository.applyCheck(
        { id: check.service.id, name: check.service.name },
        check.result,
        checkedAtIso,
      );
    }

    if (checks.length === 0) {
      return { samples: [], currentValues: [] };
    }

    const healthyCount = checks.filter(({ result }) => result.available).length;
    return {
      samples: [{
        key: "services.available_percent",
        ts: Math.floor(checkedAt.getTime() / 1_000),
        value: (healthyCount / checks.length) * 100,
      }],
      currentValues: [],
    };
  }
}
