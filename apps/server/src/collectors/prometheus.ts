import { Buffer } from "node:buffer";
import type { MacConfig, NasConfig } from "../config.js";
import type { CollectionResult, MetricSampleInput } from "./types.js";
import { fetchWithTimeout, RequestTimeoutError } from "./request.js";

type ParsedSample = {
  name: string;
  labels: ReadonlyMap<string, string>;
  value: number;
};

type CounterObservation = {
  ts: number;
  value: number;
};

const TARGET_METRICS = new Set([
  "cpu_usage_active",
  "mem_used_percent",
  "disk_used_percent",
  "net_bytes_recv",
  "net_bytes_sent",
  "node_filesystem_size_bytes",
  "node_filesystem_avail_bytes",
]);

const LABEL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PROMETHEUS_DECIMAL_PATTERN =
  /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

function parseLabels(input: string): Map<string, string> | undefined {
  const labels = new Map<string, string>();
  let index = 0;

  while (index < input.length) {
    while (input[index] === " " || input[index] === "\t") index += 1;
    const nameStart = index;
    while (index < input.length && /[a-zA-Z0-9_]/.test(input[index])) index += 1;
    const name = input.slice(nameStart, index);
    if (!LABEL_IDENTIFIER_PATTERN.test(name) || input[index] !== "=") {
      return undefined;
    }
    index += 1;
    if (input[index] !== '"') return undefined;
    index += 1;

    let value = "";
    let closed = false;
    while (index < input.length) {
      const character = input[index];
      index += 1;
      if (character === '"') {
        closed = true;
        break;
      }
      if (character !== "\\") {
        value += character;
        continue;
      }
      if (index >= input.length) return undefined;
      const escaped = input[index];
      index += 1;
      if (escaped === "n") value += "\n";
      else if (escaped === "\\" || escaped === '"') value += escaped;
      else return undefined;
    }
    if (!closed || labels.has(name)) return undefined;
    labels.set(name, value);

    while (input[index] === " " || input[index] === "\t") index += 1;
    if (index === input.length) break;
    if (input[index] !== ",") return undefined;
    index += 1;
  }

  return labels;
}

function parsePrometheusText(text: string): ParsedSample[] {
  const samples: ParsedSample[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)(?:\s+[^\s]+)?$/,
    );
    if (!match || !TARGET_METRICS.has(match[1])) continue;
    const labels = match[2] === undefined
      ? new Map<string, string>()
      : parseLabels(match[2]);
    if (labels === undefined) continue;
    if (!PROMETHEUS_DECIMAL_PATTERN.test(match[3])) continue;
    samples.push({ name: match[1], labels, value: Number(match[3]) });
  }
  return samples;
}

function matchingSamples(
  samples: readonly ParsedSample[],
  name: string,
  labels: Readonly<Record<string, string>> = {},
): ParsedSample[] {
  return samples.filter((sample) =>
    sample.name === name
    && Object.entries(labels).every(([label, value]) =>
      sample.labels.get(label) === value
    )
  );
}

function requiredMetric(
  sourceName: string,
  samples: readonly ParsedSample[],
  name: string,
  labels: Readonly<Record<string, string>> = {},
): number {
  const matches = matchingSamples(samples, name, labels);
  if (matches.length > 1) {
    throw new Error(`duplicate ${sourceName} metric ${name}`);
  }
  const value = matches[0]?.value;
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`required ${sourceName} metric ${name} is missing or invalid`);
  }
  return value;
}

function optionalCounter(
  sourceName: string,
  samples: readonly ParsedSample[],
  name: string,
  labels: Readonly<Record<string, string>>,
): number | undefined {
  const matches = matchingSamples(samples, name, labels);
  if (matches.length > 1) {
    throw new Error(`duplicate ${sourceName} metric ${name}`);
  }
  const value = matches[0]?.value;
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

async function fetchPrometheusText(
  sourceName: string,
  url: string,
  fetchImpl: typeof fetch,
  headers?: Record<string, string>,
  timeoutMs = 10_000,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, { headers }, timeoutMs);
  } catch (cause) {
    throw new Error(cause instanceof RequestTimeoutError
      ? `${sourceName} request timed out`
      : `${sourceName} request failed`);
  }
  if (!response.ok) {
    throw new Error(`${sourceName} returned HTTP ${response.status}`);
  }
  try {
    return await response.text();
  } catch {
    throw new Error(`${sourceName} response could not be read`);
  }
}

function assertTimestamp(ts: number): void {
  if (!Number.isFinite(ts)) throw new Error("collection timestamp is invalid");
}

export class MacMetricsCollector {
  readonly id = "mac";
  readonly requiresSamples = true;
  readonly intervalSeconds: number;

  private previousReceive?: CounterObservation;
  private previousTransmit?: CounterObservation;

  constructor(
    private readonly config: MacConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
    private readonly timeoutMs = 10_000,
  ) {
    this.intervalSeconds = config.intervalSeconds;
  }

  collect(): Promise<CollectionResult> {
    return this.collectAt(this.now());
  }

  async collectAt(ts: number): Promise<CollectionResult> {
    assertTimestamp(ts);
    const authorization = Buffer.from(
      `${this.config.username}:${this.config.password}`,
      "utf8",
    ).toString("base64");
    const text = await fetchPrometheusText(
      "Mac metrics",
      this.config.url,
      this.fetchImpl,
      { authorization: `Basic ${authorization}` },
      this.timeoutMs,
    );
    const parsed = parsePrometheusText(text);
    const samples: MetricSampleInput[] = [
      {
        key: "mac.cpu_percent",
        ts,
        value: clampPercent(requiredMetric(
          "Mac",
          parsed,
          "cpu_usage_active",
        )),
      },
      {
        key: "mac.memory_percent",
        ts,
        value: clampPercent(requiredMetric(
          "Mac",
          parsed,
          "mem_used_percent",
        )),
      },
      {
        key: "mac.disk_percent",
        ts,
        value: clampPercent(requiredMetric(
          "Mac",
          parsed,
          "disk_used_percent",
          { path: "/" },
        )),
      },
    ];

    const receive = optionalCounter(
      "Mac",
      parsed,
      "net_bytes_recv",
      { interface: this.config.interface },
    );
    const transmit = optionalCounter(
      "Mac",
      parsed,
      "net_bytes_sent",
      { interface: this.config.interface },
    );
    const receiveRate = this.calculateReceiveRate(receive, ts);
    const transmitRate = this.calculateTransmitRate(transmit, ts);
    if (receiveRate !== undefined) {
      samples.push({ key: "mac.network_receive_bps", ts, value: receiveRate });
    }
    if (transmitRate !== undefined) {
      samples.push({ key: "mac.network_transmit_bps", ts, value: transmitRate });
    }

    return { samples, currentValues: [] };
  }

  private calculateReceiveRate(value: number | undefined, ts: number): number | undefined {
    const result = this.calculateRate(this.previousReceive, value, ts);
    if (result.next !== undefined) this.previousReceive = result.next;
    return result.rate;
  }

  private calculateTransmitRate(value: number | undefined, ts: number): number | undefined {
    const result = this.calculateRate(this.previousTransmit, value, ts);
    if (result.next !== undefined) this.previousTransmit = result.next;
    return result.rate;
  }

  private calculateRate(
    previous: CounterObservation | undefined,
    value: number | undefined,
    ts: number,
  ): { rate?: number; next?: CounterObservation } {
    if (value === undefined) return {};
    if (previous === undefined) return { next: { ts, value } };
    const elapsed = ts - previous.ts;
    if (elapsed <= 0) return {};
    if (value < previous.value) return { next: { ts, value } };
    return {
      rate: (value - previous.value) / elapsed,
      next: { ts, value },
    };
  }
}

export class NasMetricsCollector {
  readonly id = "nas";
  readonly requiresSamples = true;
  readonly intervalSeconds: number;

  constructor(
    private readonly config: NasConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
    private readonly timeoutMs = 10_000,
  ) {
    this.intervalSeconds = config.intervalSeconds;
  }

  collect(): Promise<CollectionResult> {
    return this.collectAt(this.now());
  }

  async collectAt(ts: number): Promise<CollectionResult> {
    assertTimestamp(ts);
    const text = await fetchPrometheusText(
      "NAS metrics",
      this.config.url,
      this.fetchImpl,
      undefined,
      this.timeoutMs,
    );
    const parsed = parsePrometheusText(text);
    const labels = { mountpoint: this.config.mountpoint };
    const total = requiredMetric(
      "NAS",
      parsed,
      "node_filesystem_size_bytes",
      labels,
    );
    const available = requiredMetric(
      "NAS",
      parsed,
      "node_filesystem_avail_bytes",
      labels,
    );
    if (total < 0 || available < 0 || available > total) {
      throw new Error("invalid NAS filesystem values");
    }
    return {
      samples: [
        { key: "nas.storage_used_bytes", ts, value: total - available },
        { key: "nas.storage_total_bytes", ts, value: total },
      ],
      currentValues: [],
    };
  }
}
