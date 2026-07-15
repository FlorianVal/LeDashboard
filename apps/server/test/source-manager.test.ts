import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/db/client.js";
import type {
  CollectionResult,
  Collector,
} from "../src/collectors/types.js";
import {
  SourceManager,
  SourceRepository,
} from "../src/services/source-manager.js";
import { withRequestTimeout } from "../src/collectors/request.js";

const managers: SourceManager[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop();
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(now = new Date("2026-07-14T12:00:00.000Z")) {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-manager-"));
  const ctx = createDatabase(join(directory, "ledashboard-v2.sqlite"));
  const repository = new SourceRepository(ctx.sqlite);
  const manager = new SourceManager(repository, () => now);

  managers.push(manager);
  cleanups.push(() => {
    ctx.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  return { ctx, manager, repository };
}

function fakeCollector(
  result: CollectionResult,
  options: Partial<Pick<Collector, "id" | "intervalSeconds" | "requiresSamples">> = {},
): Collector {
  return {
    id: options.id ?? "home-assistant",
    intervalSeconds: options.intervalSeconds ?? 300,
    requiresSamples: options.requiresSamples ?? true,
    async collect() {
      return result;
    },
  };
}

function countedCollector(
  id: string,
  intervalSeconds: number,
  collect: () => Promise<CollectionResult>,
): Collector {
  return { id, intervalSeconds, requiresSamples: false, collect };
}

const emptyResult: CollectionResult = { samples: [], currentValues: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("SourceManager", () => {
  it("marks an empty required collection as failed", async () => {
    const { manager, repository } = setup();
    const collector = fakeCollector(emptyResult);

    await expect(manager.runOnce(collector)).rejects.toThrow(
      "home-assistant returned no required samples",
    );
    expect(repository.getSourceState("home-assistant")?.lastError)
      .toContain("no required samples");
  });

  it("commits samples, current values, and source success together", async () => {
    const { ctx, manager, repository } = setup();
    const collector = fakeCollector({
      samples: [
        { key: "comfort.indoor_temperature", ts: 100, value: 22.5 },
      ],
      currentValues: [
        { key: "weather.condition", ts: 100, textValue: "sunny" },
      ],
    });

    await manager.runOnce(collector);

    expect(ctx.sqlite.prepare("SELECT value FROM samples_raw").get())
      .toEqual({ value: 22.5 });
    expect(ctx.sqlite.prepare("SELECT text_value FROM current_values").get())
      .toEqual({ text_value: "sunny" });
    expect(repository.getSourceState("home-assistant")).toEqual({
      sourceId: "home-assistant",
      lastAttemptAt: "2026-07-14T12:00:00.000Z",
      lastSuccessAt: "2026-07-14T12:00:00.000Z",
      lastError: null,
    });
  });

  it("rolls back collection writes before recording a failed commit", async () => {
    const { ctx, manager, repository } = setup();
    const collector = fakeCollector({
      samples: [
        { key: "comfort.indoor_temperature", ts: 100, value: 22.5 },
        { key: "not-a-curated-key" as never, ts: 100, value: 1 },
      ],
      currentValues: [],
    });

    await expect(manager.runOnce(collector)).rejects.toThrow();

    expect(ctx.sqlite.prepare("SELECT COUNT(*) AS count FROM samples_raw").get())
      .toEqual({ count: 0 });
    expect(repository.getSourceState("home-assistant")?.lastSuccessAt).toBeNull();
    expect(repository.getSourceState("home-assistant")?.lastError).toBeTruthy();
  });

  it("runs every collector immediately on its independent schedule", async () => {
    vi.useFakeTimers();
    const { manager } = setup();
    const fastCollect = vi.fn(async () => emptyResult);
    const slowCollect = vi.fn(async () => emptyResult);

    manager.start([
      countedCollector("fast", 5, fastCollect),
      countedCollector("slow", 11, slowCollect),
    ]);

    expect(fastCollect).toHaveBeenCalledTimes(1);
    expect(slowCollect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fastCollect).toHaveBeenCalledTimes(3);
    expect(slowCollect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(slowCollect).toHaveBeenCalledTimes(2);
  });

  it("does not overlap a slow collector with its next scheduled tick", async () => {
    vi.useFakeTimers();
    const { manager } = setup();
    const firstRun = deferred<CollectionResult>();
    const collect = vi.fn()
      .mockImplementationOnce(() => firstRun.promise)
      .mockResolvedValue(emptyResult);

    manager.start([countedCollector("slow", 5, collect)]);
    expect(collect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(collect).toHaveBeenCalledTimes(1);

    firstRun.resolve(emptyResult);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight guard after a bounded request times out", async () => {
    vi.useFakeTimers();
    const { manager } = setup();
    let attempts = 0;
    const collector = countedCollector("bounded", 5, async () => {
      attempts += 1;
      if (attempts === 1) {
        await withRequestTimeout(
          () => new Promise<Response>(() => undefined),
          1_000,
        );
      }
      return emptyResult;
    });

    manager.start([collector]);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(attempts).toBe(2);
  });

  it("waits for an in-flight collection before stopping cleanly", async () => {
    const { manager } = setup();
    const collection = deferred<CollectionResult>();
    manager.start([countedCollector("closing", 60, () => collection.promise)]);
    let stopped = false;

    const stopping = Promise.resolve(manager.stop()).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    collection.resolve(emptyResult);
    await stopping;
    expect(stopped).toBe(true);
  });

  it("isolates a failed collector from healthy scheduled collectors", async () => {
    vi.useFakeTimers();
    const { manager, repository } = setup();
    const failedCollect = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const healthyCollect = vi.fn(async () => emptyResult);

    manager.start([
      countedCollector("failed", 5, failedCollect),
      countedCollector("healthy", 5, healthyCollect),
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(failedCollect).toHaveBeenCalledTimes(1);
    expect(healthyCollect).toHaveBeenCalledTimes(1);
    expect(repository.getSourceState("failed")?.lastError)
      .toBe("Collection failed for failed");
    expect(repository.getSourceState("healthy")?.lastSuccessAt)
      .toBe("2026-07-14T12:00:00.000Z");
  });

  it("logs only a safe source id and category for scheduled failures", async () => {
    vi.useFakeTimers();
    const { repository } = setup();
    const diagnostics = vi.fn();
    const scheduled = new SourceManager(
      repository,
      () => new Date("2026-07-14T12:00:00.000Z"),
      { diagnostic: diagnostics },
    );
    managers.push(scheduled);

    scheduled.start([countedCollector("safe-source", 5, async () => {
      throw new Error("token=super-secret");
    })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(diagnostics).toHaveBeenCalledWith({
      sourceId: "safe-source",
      category: "collection_failed",
    });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("super-secret");
  });

  it("clears every interval when stopped", async () => {
    vi.useFakeTimers();
    const { manager } = setup();
    const collect = vi.fn(async () => emptyResult);

    manager.start([countedCollector("scheduled", 5, collect)]);
    expect(collect).toHaveBeenCalledTimes(1);

    manager.stop();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(collect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts once without retaining stopped or duplicate intervals", async () => {
    vi.useFakeTimers();
    const { manager } = setup();
    const collect = vi.fn(async () => emptyResult);
    const collector = countedCollector("restartable", 5, collect);

    manager.start([collector]);
    await vi.advanceTimersByTimeAsync(0);
    expect(collect).toHaveBeenCalledTimes(1);

    manager.stop();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(collect).toHaveBeenCalledTimes(1);

    manager.start([collector]);
    await vi.advanceTimersByTimeAsync(0);
    expect(collect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(collect).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each([
    {
      label: "JSON token",
      raw: 'request failed: {"token":"json-secret"}',
      secrets: ["json-secret"],
    },
    {
      label: "quoted multi-word password",
      raw: 'password="quoted multi word secret"',
      secrets: ["quoted multi word secret"],
    },
    {
      label: "client_secret field",
      raw: "client_secret=client-secret-value",
      secrets: ["client-secret-value"],
    },
    {
      label: "URL userinfo",
      raw: "https://service-user:url-password@example.test/data failed",
      secrets: ["service-user", "url-password"],
    },
    {
      label: "Bearer header",
      raw: "Authorization: Bearer bearer-secret-value",
      secrets: ["bearer-secret-value"],
    },
    {
      label: "query parameters",
      raw: "https://example.test/data?token=query-token&password=query-password",
      secrets: ["query-token", "query-password"],
    },
  ])("never exposes an untrusted $label collector error", async ({ raw, secrets }) => {
    const { manager, repository } = setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const collector = countedCollector("secret-source", 5, async () => {
      throw new Error(raw);
    });

    let thrown = "";
    try {
      await manager.runOnce(collector);
    } catch (cause) {
      thrown = cause instanceof Error ? cause.message : String(cause);
    }

    const storedError = repository.getSourceState("secret-source")?.lastError ?? "";
    expect(thrown).toBe("Collection failed for secret-source");
    expect(storedError).toBe("Collection failed for secret-source");
    for (const secret of secrets) {
      expect(thrown).not.toContain(secret);
      expect(storedError).not.toContain(secret);
    }
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
