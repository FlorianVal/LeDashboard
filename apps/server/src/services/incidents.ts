import type Database from "better-sqlite3";

export type ServiceAvailabilityState =
  | "up"
  | "slow"
  | "degraded"
  | "down"
  | "recovering";

export type ServiceCheckError =
  | "timeout"
  | "request_failed"
  | "unexpected_status";

export type ServiceCheckResult = {
  available: boolean;
  slow: boolean;
  latencyMs: number | null;
  error: ServiceCheckError | null;
};

export type ServiceIdentity = {
  id: string;
  name: string;
};

export type ServiceState = {
  serviceId: string;
  name: string;
  state: ServiceAvailabilityState;
  latencyMs: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  activeIncidentId: number | null;
};

export type Incident = {
  id: number;
  serviceId: string;
  startedAt: string;
  endedAt: string | null;
  lastError: string | null;
};

type ServiceStateRow = {
  service_id: string;
  name: string;
  state: ServiceAvailabilityState;
  latency_ms: number | null;
  consecutive_failures: number;
  consecutive_successes: number;
  active_incident_id: number | null;
};

type IncidentRow = {
  id: number;
  service_id: string;
  started_at: string;
  ended_at: string | null;
  last_error: string | null;
};

function mapServiceState(row: ServiceStateRow): ServiceState {
  return {
    serviceId: row.service_id,
    name: row.name,
    state: row.state,
    latencyMs: row.latency_ms,
    consecutiveFailures: row.consecutive_failures,
    consecutiveSuccesses: row.consecutive_successes,
    activeIncidentId: row.active_incident_id,
  };
}

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    serviceId: row.service_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastError: row.last_error,
  };
}

export class IncidentRepository {
  constructor(private readonly sqlite: Database.Database) {}

  applyCheck(
    service: ServiceIdentity,
    check: ServiceCheckResult,
    checkedAt: string,
  ): ServiceState {
    return this.sqlite.transaction(() => {
      const previous = this.getServiceState(service.id);
      let activeIncidentId = previous?.activeIncidentId ?? null;
      let consecutiveFailures: number;
      let consecutiveSuccesses: number;
      let state: ServiceAvailabilityState;

      if (check.available) {
        consecutiveFailures = 0;
        consecutiveSuccesses = (previous?.consecutiveSuccesses ?? 0) + 1;
        if (activeIncidentId !== null && consecutiveSuccesses < 2) {
          state = "recovering";
        } else {
          if (activeIncidentId !== null) {
            this.sqlite.prepare(`
              UPDATE incidents SET ended_at = ? WHERE id = ? AND ended_at IS NULL
            `).run(checkedAt, activeIncidentId);
            activeIncidentId = null;
          }
          state = check.slow ? "slow" : "up";
        }
      } else {
        consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
        consecutiveSuccesses = 0;
        if (activeIncidentId !== null || consecutiveFailures >= 2) {
          state = "down";
          if (activeIncidentId === null) {
            const inserted = this.sqlite.prepare(`
              INSERT INTO incidents (service_id, started_at, ended_at, last_error)
              VALUES (?, ?, NULL, ?)
            `).run(service.id, checkedAt, check.error);
            activeIncidentId = Number(inserted.lastInsertRowid);
          } else {
            this.sqlite.prepare(`
              UPDATE incidents SET last_error = ? WHERE id = ? AND ended_at IS NULL
            `).run(check.error, activeIncidentId);
          }
        } else {
          state = "degraded";
        }
      }

      this.sqlite.prepare(`
        INSERT INTO service_state (
          service_id,
          name,
          state,
          latency_ms,
          consecutive_failures,
          consecutive_successes,
          active_incident_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(service_id) DO UPDATE SET
          name = excluded.name,
          state = excluded.state,
          latency_ms = excluded.latency_ms,
          consecutive_failures = excluded.consecutive_failures,
          consecutive_successes = excluded.consecutive_successes,
          active_incident_id = excluded.active_incident_id
      `).run(
        service.id,
        service.name,
        state,
        check.latencyMs,
        consecutiveFailures,
        consecutiveSuccesses,
        activeIncidentId,
      );

      return {
        serviceId: service.id,
        name: service.name,
        state,
        latencyMs: check.latencyMs,
        consecutiveFailures,
        consecutiveSuccesses,
        activeIncidentId,
      };
    })();
  }

  getServiceState(serviceId: string): ServiceState | null {
    const row = this.sqlite.prepare(`
      SELECT
        service_id,
        name,
        state,
        latency_ms,
        consecutive_failures,
        consecutive_successes,
        active_incident_id
      FROM service_state
      WHERE service_id = ?
    `).get(serviceId) as ServiceStateRow | undefined;
    return row ? mapServiceState(row) : null;
  }

  getServiceStates(): ServiceState[] {
    const rows = this.sqlite.prepare(`
      SELECT
        service_id,
        name,
        state,
        latency_ms,
        consecutive_failures,
        consecutive_successes,
        active_incident_id
      FROM service_state
      ORDER BY service_id
    `).all() as ServiceStateRow[];
    return rows.map(mapServiceState);
  }

  getActiveIncidents(): Incident[] {
    const rows = this.sqlite.prepare(`
      SELECT id, service_id, started_at, ended_at, last_error
      FROM incidents
      WHERE ended_at IS NULL
      ORDER BY started_at, id
    `).all() as IncidentRow[];
    return rows.map(mapIncident);
  }

  getIncidents(): Incident[] {
    const rows = this.sqlite.prepare(`
      SELECT id, service_id, started_at, ended_at, last_error
      FROM incidents
      ORDER BY started_at, id
    `).all() as IncidentRow[];
    return rows.map(mapIncident);
  }
}
