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
      .toBe("connection refused");
    expect(repository.getSourceState("healthy")?.lastSuccessAt)
      .toBe("2026-07-14T12:00:00.000Z");
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

  it("redacts credentials from failures and does not log them", async () => {
    const { manager, repository } = setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const collector = countedCollector("secret-source", 5, async () => {
      throw new Error(
        "Bearer bearer-secret failed at https://user:password-secret@example.test/data?token=query-secret&password=other-secret",
      );
    });

    await expect(manager.runOnce(collector)).rejects.toThrow("[redacted]");

    const storedError = repository.getSourceState("secret-source")?.lastError ?? "";
    expect(storedError).not.toContain("bearer-secret");
    expect(storedError).not.toContain("password-secret");
    expect(storedError).not.toContain("query-secret");
    expect(storedError).not.toContain("other-secret");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
