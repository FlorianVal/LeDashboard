import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/client.js";
import {
  IncidentRepository,
  type ServiceCheckResult,
} from "../src/services/incidents.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-incidents-"));
  const ctx = createDatabase(join(directory, "ledashboard-v2.sqlite"));
  const repository = new IncidentRepository(ctx.sqlite);
  cleanups.push(() => {
    ctx.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { ctx, repository };
}

const plex = { id: "plex", name: "Plex" };

function success(latencyMs: number, slow = false): ServiceCheckResult {
  return { available: true, slow, latencyMs, error: null };
}

function failure(error: ServiceCheckResult["error"]): ServiceCheckResult {
  return { available: false, slow: false, latencyMs: null, error };
}

describe("IncidentRepository", () => {
  it("persists a capture incident at six missed intervals and closes it on recovery", () => {
    const { repository } = setup();
    const now = new Date("2026-07-14T12:00:00.000Z");

    repository.applyCaptureStatus({
      lastSuccessAt: "2026-07-14T11:58:30.000Z",
      lastErrorAt: null,
      expectedIntervalSeconds: 30,
    }, now.toISOString());
    expect(repository.getServiceState("letimelapse-capture")).toMatchObject({
      name: "Capture timelapse",
      state: "degraded",
    });
    expect(repository.getActiveIncidents()).toEqual([]);

    repository.applyCaptureStatus({
      lastSuccessAt: "2026-07-14T11:57:00.000Z",
      lastErrorAt: null,
      expectedIntervalSeconds: 30,
    }, now.toISOString());
    expect(repository.getServiceState("letimelapse-capture")?.state).toBe("down");
    expect(repository.getActiveIncidents()).toEqual([
      expect.objectContaining({
        serviceId: "letimelapse-capture",
        endedAt: null,
        lastError: "capture_stale",
      }),
    ]);

    repository.applyCaptureStatus({
      lastSuccessAt: "2026-07-14T11:59:45.000Z",
      lastErrorAt: "2026-07-14T11:58:00.000Z",
      expectedIntervalSeconds: 30,
    }, now.toISOString());
    expect(repository.getServiceState("letimelapse-capture")?.state).toBe("up");
    expect(repository.getActiveIncidents()).toEqual([]);
    expect(repository.getIncidents()).toEqual([
      expect.objectContaining({
        serviceId: "letimelapse-capture",
        endedAt: now.toISOString(),
      }),
    ]);
  });

  it("opens a capture incident immediately when the latest error is newer", () => {
    const { repository } = setup();
    repository.applyCaptureStatus({
      lastSuccessAt: "2026-07-14T11:59:45.000Z",
      lastErrorAt: "2026-07-14T11:59:50.000Z",
      expectedIntervalSeconds: 30,
    }, "2026-07-14T12:00:00.000Z");

    expect(repository.getActiveIncidents()).toEqual([
      expect.objectContaining({
        serviceId: "letimelapse-capture",
        lastError: "capture_error",
      }),
    ]);
  });

  it("opens after two failures and closes after two successes", () => {
    const { repository } = setup();

    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:00:00Z");
    expect(repository.getServiceState("plex")?.state).toBe("degraded");

    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:01:00Z");
    expect(repository.getServiceState("plex")?.state).toBe("down");
    expect(repository.getActiveIncidents()).toHaveLength(1);
    expect(repository.getServiceState("plex")?.activeIncidentId)
      .toBe(repository.getActiveIncidents()[0]?.id);

    repository.applyCheck(plex, success(22), "2026-07-14T10:02:00Z");
    expect(repository.getServiceState("plex")?.state).toBe("recovering");

    repository.applyCheck(plex, success(20), "2026-07-14T10:03:00Z");
    expect(repository.getServiceState("plex")?.state).toBe("up");
    expect(repository.getActiveIncidents()).toHaveLength(0);
    expect(repository.getIncidents()).toEqual([
      {
        id: 1,
        serviceId: "plex",
        startedAt: "2026-07-14T10:01:00Z",
        endedAt: "2026-07-14T10:03:00Z",
        lastError: "timeout",
      },
    ]);
  });

  it("recovers immediately when a single degraded check did not open an incident", () => {
    const { repository } = setup();

    repository.applyCheck(plex, failure("request_failed"), "2026-07-14T10:00:00Z");
    repository.applyCheck(plex, success(18), "2026-07-14T10:01:00Z");

    expect(repository.getServiceState("plex")).toMatchObject({
      state: "up",
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      activeIncidentId: null,
    });
    expect(repository.getIncidents()).toEqual([]);
  });

  it("keeps slow checks available and never opens a slow-only incident", () => {
    const { repository } = setup();

    repository.applyCheck(plex, success(1_250, true), "2026-07-14T10:00:00Z");
    repository.applyCheck(plex, success(1_400, true), "2026-07-14T10:01:00Z");

    expect(repository.getServiceState("plex")).toMatchObject({
      state: "slow",
      latencyMs: 1_400,
      consecutiveFailures: 0,
      consecutiveSuccesses: 2,
      activeIncidentId: null,
    });
    expect(repository.getIncidents()).toEqual([]);
  });

  it("keeps an incident open across repeated failures and closes it on two slow successes", () => {
    const { repository } = setup();

    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:00:00Z");
    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:01:00Z");
    repository.applyCheck(plex, failure("request_failed"), "2026-07-14T10:02:00Z");
    repository.applyCheck(plex, success(1_250, true), "2026-07-14T10:03:00Z");
    repository.applyCheck(plex, success(1_100, true), "2026-07-14T10:04:00Z");

    expect(repository.getServiceState("plex")?.state).toBe("slow");
    expect(repository.getActiveIncidents()).toEqual([]);
    expect(repository.getIncidents()).toHaveLength(1);
    expect(repository.getIncidents()[0]).toMatchObject({
      startedAt: "2026-07-14T10:01:00Z",
      endedAt: "2026-07-14T10:04:00Z",
      lastError: "request_failed",
    });
  });

  it("returns to down without opening a new incident when recovery is interrupted", () => {
    const { repository } = setup();
    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:00:00Z");
    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:01:00Z");
    const incidentId = repository.getActiveIncidents()[0]?.id;
    repository.applyCheck(plex, success(20), "2026-07-14T10:02:00Z");

    repository.applyCheck(
      plex,
      failure("request_failed"),
      "2026-07-14T10:03:00Z",
    );

    expect(repository.getServiceState("plex")).toMatchObject({
      state: "down",
      consecutiveFailures: 1,
      consecutiveSuccesses: 0,
      activeIncidentId: incidentId,
    });
    expect(repository.getActiveIncidents()).toEqual([
      expect.objectContaining({ id: incidentId, lastError: "request_failed" }),
    ]);
  });

  it("rolls back the service transition when opening its incident fails", () => {
    const { ctx, repository } = setup();
    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:00:00Z");
    ctx.sqlite.exec(`
      CREATE TRIGGER reject_incident_insert
      BEFORE INSERT ON incidents
      BEGIN
        SELECT RAISE(ABORT, 'injected incident failure');
      END;
    `);

    expect(() => repository.applyCheck(
      plex,
      failure("request_failed"),
      "2026-07-14T10:01:00Z",
    )).toThrow("injected incident failure");

    expect(repository.getServiceState("plex")).toMatchObject({
      state: "degraded",
      consecutiveFailures: 1,
      consecutiveSuccesses: 0,
      activeIncidentId: null,
    });
    expect(repository.getIncidents()).toEqual([]);
  });

  it("does not duplicate the active incident for back-to-back down checks", () => {
    const { repository } = setup();

    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:00:00Z");
    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:01:00Z");
    repository.applyCheck(plex, failure("request_failed"), "2026-07-14T10:01:00Z");

    const state = repository.getServiceState("plex");
    const incidents = repository.getActiveIncidents();
    expect(incidents).toHaveLength(1);
    expect(state).toMatchObject({
      state: "down",
      consecutiveFailures: 3,
      activeIncidentId: incidents[0]?.id,
    });
  });

  it("rolls back incident closure and service recovery together", () => {
    const { ctx, repository } = setup();
    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:00:00Z");
    repository.applyCheck(plex, failure("timeout"), "2026-07-14T10:01:00Z");
    repository.applyCheck(plex, success(20), "2026-07-14T10:02:00Z");
    const incidentId = repository.getActiveIncidents()[0]?.id;
    ctx.sqlite.exec(`
      CREATE TRIGGER reject_incident_close
      BEFORE UPDATE ON incidents
      WHEN NEW.ended_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'injected incident close failure');
      END;
    `);

    expect(() => repository.applyCheck(
      plex,
      success(18),
      "2026-07-14T10:03:00Z",
    )).toThrow("injected incident close failure");

    expect(repository.getServiceState("plex")).toMatchObject({
      state: "recovering",
      consecutiveSuccesses: 1,
      activeIncidentId: incidentId,
    });
    expect(repository.getActiveIncidents()).toEqual([
      expect.objectContaining({ id: incidentId, endedAt: null }),
    ]);
  });
});
