import { describe, expect, it } from "vitest";
import type { MacConfig, NasConfig } from "../src/config.js";
import {
  MacMetricsCollector,
  NasMetricsCollector,
} from "../src/collectors/prometheus.js";
import type { CollectionResult } from "../src/collectors/types.js";

const macConfig: MacConfig = {
  url: "http://mac.test:9273/metrics",
  username: "metrics-user",
  password: "metrics-password",
  intervalSeconds: 60,
  interface: "en0",
};

const nasConfig: NasConfig = {
  url: "http://nas.test:9100/metrics",
  intervalSeconds: 300,
  mountpoint: "/share/CACHEDEV1_DATA",
};

function macFixture(overrides: Partial<Record<string, string>> = {}): string {
  const lines = {
    cpu: "cpu_usage_active 38",
    memory: "mem_used_percent 61",
    disk: 'disk_used_percent{path="/"} 42',
    receive: 'net_bytes_recv{interface="en0"} 1000',
    transmit: 'net_bytes_sent{interface="en0"} 500',
    ...overrides,
  };
  return [lines.cpu, lines.memory, lines.disk, lines.receive, lines.transmit]
    .join("\n");
}

function mutableTextFixture(initial: string, status = 200) {
  let body = initial;
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response(body, {
      status,
      headers: { "content-type": "text/plain; version=0.0.4" },
    });
  };
  return {
    fetchImpl,
    requests,
    setBody(next: string) {
      body = next;
    },
  };
}

function sampleValue(result: CollectionResult, key: string): number | undefined {
  return result.samples.find((sample) => sample.key === key)?.value;
}

describe("MacMetricsCollector", () => {
  it("bounds a native metrics request that never settles", async () => {
    const collector = new MacMetricsCollector(
      macConfig,
      () => new Promise<Response>(() => undefined),
      () => 100,
      5,
    );

    await expect(collector.collect()).rejects.toThrow("Mac metrics request timed out");
  });

  it("maps native Telegraf gauges and converts configured-interface counters to rates", async () => {
    const fixture = mutableTextFixture([
      "# HELP cpu_usage_active Percentage of time the CPU was active",
      "# TYPE cpu_usage_active gauge",
      'disk_used_percent{path="/Volumes/External"} 99',
      'net_bytes_recv{interface="bridge0"} 999999',
      macFixture(),
    ].join("\n"));
    const collector = new MacMetricsCollector(macConfig, fixture.fetchImpl, () => 100);

    const first = await collector.collect();
    fixture.setBody(macFixture({
      cpu: "cpu_usage_active 39",
      memory: "mem_used_percent 62",
      receive: 'net_bytes_recv{interface="en0"} 1600',
      transmit: 'net_bytes_sent{interface="en0"} 800',
    }));
    const second = await collector.collectAt(110);

    expect(collector).toMatchObject({
      id: "mac",
      intervalSeconds: 60,
      requiresSamples: true,
    });
    expect(fixture.requests).toEqual([
      {
        url: macConfig.url,
        authorization: `Basic ${Buffer.from("metrics-user:metrics-password").toString("base64")}`,
      },
      {
        url: macConfig.url,
        authorization: `Basic ${Buffer.from("metrics-user:metrics-password").toString("base64")}`,
      },
    ]);
    expect(first).toEqual({
      samples: [
        { key: "mac.cpu_percent", ts: 100, value: 38 },
        { key: "mac.memory_percent", ts: 100, value: 61 },
        { key: "mac.disk_percent", ts: 100, value: 42 },
      ],
      currentValues: [],
    });
    expect(sampleValue(second, "mac.network_receive_bps")).toBe(60);
    expect(sampleValue(second, "mac.network_transmit_bps")).toBe(30);
    expect(second.samples.every(({ ts }) => ts === 110)).toBe(true);
  });

  it("clamps required percentages to the closed range from zero through one hundred", async () => {
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(macFixture({
        cpu: "cpu_usage_active -0.5",
        memory: "mem_used_percent 100.25",
        disk: 'disk_used_percent{path="/"} 150',
      })).fetchImpl,
      () => 100,
    );

    const result = await collector.collect();

    expect(result.samples.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "mac.cpu_percent", value: 0 },
      { key: "mac.memory_percent", value: 100 },
      { key: "mac.disk_percent", value: 100 },
    ]);
  });

  it("omits reset and non-monotonic rates instead of recording zero", async () => {
    const fixture = mutableTextFixture(macFixture());
    const collector = new MacMetricsCollector(macConfig, fixture.fetchImpl, () => 100);
    await collector.collect();

    fixture.setBody(macFixture({
      receive: 'net_bytes_recv{interface="en0"} 100',
      transmit: 'net_bytes_sent{interface="en0"} 800',
    }));
    const reset = await collector.collectAt(110);

    expect(sampleValue(reset, "mac.network_receive_bps")).toBeUndefined();
    expect(sampleValue(reset, "mac.network_transmit_bps")).toBe(30);
    expect(reset.samples.some(({ value }) => Object.is(value, 0))).toBe(false);

    fixture.setBody(macFixture({
      receive: 'net_bytes_recv{interface="en0"} 700',
      transmit: 'net_bytes_sent{interface="en0"} 1100',
    }));
    const afterReset = await collector.collectAt(120);

    expect(sampleValue(afterReset, "mac.network_receive_bps")).toBe(60);
    expect(sampleValue(afterReset, "mac.network_transmit_bps")).toBe(30);
  });

  it("requires positive elapsed time before emitting network rates", async () => {
    const fixture = mutableTextFixture(macFixture());
    const collector = new MacMetricsCollector(macConfig, fixture.fetchImpl, () => 100);
    await collector.collect();

    fixture.setBody(macFixture({
      receive: 'net_bytes_recv{interface="en0"} 1600',
      transmit: 'net_bytes_sent{interface="en0"} 800',
    }));

    const sameTime = await collector.collectAt(100);
    const earlier = await collector.collectAt(99);

    for (const result of [sameTime, earlier]) {
      expect(sampleValue(result, "mac.network_receive_bps")).toBeUndefined();
      expect(sampleValue(result, "mac.network_transmit_bps")).toBeUndefined();
    }
  });

  it("does not invent zero network rates when counters are absent or invalid", async () => {
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(macFixture({
        receive: 'net_bytes_recv{interface="en0"} NaN',
        transmit: 'net_bytes_sent{interface="bridge0"} 500',
      })).fetchImpl,
      () => 100,
    );

    const result = await collector.collect();

    expect(result.samples.map(({ key }) => key)).toEqual([
      "mac.cpu_percent",
      "mac.memory_percent",
      "mac.disk_percent",
    ]);
  });

  it("matches decoded Prometheus label escapes exactly", async () => {
    const escapedConfig: MacConfig = {
      ...macConfig,
      interface: 'en"0\\prod',
    };
    const fixture = mutableTextFixture(macFixture({
      receive: 'net_bytes_recv{interface="en\\"0\\\\prod"} 1000',
      transmit: 'net_bytes_sent{interface="en\\"0\\\\prod"} 500',
    }));
    const collector = new MacMetricsCollector(escapedConfig, fixture.fetchImpl, () => 100);
    await collector.collect();
    fixture.setBody(macFixture({
      receive: 'net_bytes_recv{interface="en\\"0\\\\prod"} 1600',
      transmit: 'net_bytes_sent{interface="en\\"0\\\\prod"} 800',
    }));

    const result = await collector.collectAt(110);

    expect(sampleValue(result, "mac.network_receive_bps")).toBe(60);
    expect(sampleValue(result, "mac.network_transmit_bps")).toBe(30);
  });

  it("rejects duplicate matching gauge series as ambiguous", async () => {
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(`${macFixture()}\ncpu_usage_active 39`).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(/duplicate Mac metric/);
  });

  it.each([
    ["hexadecimal", "0x20"],
    ["binary", "0b100000"],
    ["octal", "0o40"],
  ])("rejects a JS-coercible %s required numeric token", async (_label, token) => {
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(macFixture({
        cpu: `cpu_usage_active ${token}`,
      })).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(/required Mac metric/);
  });

  it("rejects a required sample whose label name starts with a digit", async () => {
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(macFixture({
        cpu: 'cpu_usage_active{1cpu="total"} 38',
      })).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(/required Mac metric/);
  });

  it("accepts signed decimal and scientific required numeric tokens", async () => {
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(macFixture({
        cpu: "cpu_usage_active +38.5",
        memory: "mem_used_percent 6.1E+1",
        disk: 'disk_used_percent{path="/"} .42e2',
      })).fetchImpl,
      () => 100,
    );

    const result = await collector.collect();

    expect(result.samples.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "mac.cpu_percent", value: 38.5 },
      { key: "mac.memory_percent", value: 61 },
      { key: "mac.disk_percent", value: 42 },
    ]);
  });

  it.each([
    ["CPU", { cpu: "" }],
    ["CPU", { cpu: "cpu_usage_active NaN" }],
    ["memory", { memory: "" }],
    ["memory", { memory: "mem_used_percent +Inf" }],
    ["root disk", { disk: 'disk_used_percent{path="/Volumes/External"} 42' }],
    ["root disk", { disk: 'disk_used_percent{path="/"} nope' }],
  ])("rejects a missing or invalid required %s gauge", async (_label, override) => {
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(macFixture(override)).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(/required Mac metric/);
  });

  it("does not expose Basic-auth credentials or response bodies in HTTP errors", async () => {
    const bodySecret = "prometheus-body-secret";
    const collector = new MacMetricsCollector(
      macConfig,
      mutableTextFixture(bodySecret, 401).fetchImpl,
    );

    const error = await collector.collect().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Mac metrics returned HTTP 401");
    expect((error as Error).message).not.toContain(bodySecret);
    expect((error as Error).message).not.toContain(macConfig.username);
    expect((error as Error).message).not.toContain(macConfig.password);
    expect((error as Error).message).not.toContain(macConfig.url);
  });

  it("sanitizes transport errors that contain Basic-auth credentials", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error(`request failed for ${macConfig.username}:${macConfig.password}`);
    };
    const collector = new MacMetricsCollector(macConfig, fetchImpl);

    const error = await collector.collect().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Mac metrics request failed");
    expect((error as Error).message).not.toContain(macConfig.username);
    expect((error as Error).message).not.toContain(macConfig.password);
  });
});

describe("NasMetricsCollector", () => {
  it("bounds a NAS metrics request that never settles", async () => {
    const collector = new NasMetricsCollector(
      nasConfig,
      () => new Promise<Response>(() => undefined),
      () => 100,
      5,
    );

    await expect(collector.collect()).rejects.toThrow("NAS metrics request timed out");
  });

  it("selects only the configured QNAP main data volume", async () => {
    const body = [
      'node_filesystem_size_bytes{device="rootfs",fstype="ext4",mountpoint="/"} 500',
      'node_filesystem_avail_bytes{device="rootfs",fstype="ext4",mountpoint="/"} 100',
      'node_filesystem_size_bytes{device="/dev/mapper/cachedev1",fstype="ext4",mountpoint="/share/CACHEDEV1_DATA"} 10000',
      'node_filesystem_avail_bytes{device="/dev/mapper/cachedev1",fstype="ext4",mountpoint="/share/CACHEDEV1_DATA"} 7000',
    ].join("\n");
    const collector = new NasMetricsCollector(
      nasConfig,
      mutableTextFixture(body).fetchImpl,
      () => 200,
    );

    const result = await collector.collect();

    expect(collector).toMatchObject({
      id: "nas",
      intervalSeconds: 300,
      requiresSamples: true,
    });
    expect(result).toEqual({
      samples: [
        { key: "nas.storage_used_bytes", ts: 200, value: 3000 },
        { key: "nas.storage_total_bytes", ts: 200, value: 10000 },
      ],
      currentValues: [],
    });
  });

  it("rejects filesystem series when the configured mountpoint is absent", async () => {
    const body = [
      'node_filesystem_size_bytes{mountpoint="/"} 10000',
      'node_filesystem_avail_bytes{mountpoint="/"} 7000',
    ].join("\n");
    const collector = new NasMetricsCollector(
      nasConfig,
      mutableTextFixture(body).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(/required NAS metric/);
  });

  it("rejects duplicate matching filesystem series as ambiguous", async () => {
    const body = [
      'node_filesystem_size_bytes{device="a",mountpoint="/share/CACHEDEV1_DATA"} 10000',
      'node_filesystem_size_bytes{device="b",mountpoint="/share/CACHEDEV1_DATA"} 12000',
      'node_filesystem_avail_bytes{mountpoint="/share/CACHEDEV1_DATA"} 7000',
    ].join("\n");
    const collector = new NasMetricsCollector(
      nasConfig,
      mutableTextFixture(body).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(/duplicate NAS metric/);
  });

  it.each([
    ["size", 'node_filesystem_avail_bytes{mountpoint="/share/CACHEDEV1_DATA"} 7000'],
    ["available", 'node_filesystem_size_bytes{mountpoint="/share/CACHEDEV1_DATA"} 10000'],
    ["finite size", 'node_filesystem_size_bytes{mountpoint="/share/CACHEDEV1_DATA"} NaN\nnode_filesystem_avail_bytes{mountpoint="/share/CACHEDEV1_DATA"} 7000'],
    ["nonnegative available", 'node_filesystem_size_bytes{mountpoint="/share/CACHEDEV1_DATA"} 10000\nnode_filesystem_avail_bytes{mountpoint="/share/CACHEDEV1_DATA"} -1'],
    ["available not above size", 'node_filesystem_size_bytes{mountpoint="/share/CACHEDEV1_DATA"} 10000\nnode_filesystem_avail_bytes{mountpoint="/share/CACHEDEV1_DATA"} 10001'],
  ])("rejects an invalid required NAS %s value", async (_label, body) => {
    const collector = new NasMetricsCollector(
      nasConfig,
      mutableTextFixture(body).fetchImpl,
    );

    await expect(collector.collect()).rejects.toThrow(/required NAS metric|invalid NAS filesystem/);
  });
});
