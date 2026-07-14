# LaMaison House-Life Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LeDashboard's stale generic metric browser with the approved seven-chart house-life panorama, backed by real Mac mini, NAS, Home Assistant, LaPlante, LeTimelapse, and service-availability data.

**Architecture:** Keep the existing React, Fastify, and SQLite application on the Mac mini, but replace dynamic metric discovery with curated collectors and stable metric keys. Add small read-only summary contracts to LaPlante and LeTimelapse, use native macOS Telegraf plus a host-aware QNAP node exporter, and retain raw, five-minute, and hourly data for 7, 30, and 180 days.

**Tech Stack:** TypeScript, React 19, Fastify 5, SQLite/better-sqlite3, Recharts, Vitest, Node test runner, Playwright, Home Assistant REST API, Telegraf, Prometheus text exposition, Apple Container, QNAP Container Station.

## Global Constraints

- The home page contains exactly seven charts: comfort, overdue plants, timelapse storage, Mac resources, Mac network, NAS storage, and availability.
- Default windows are 24 hours for comfort and Mac charts, 30 days for plants and availability, and 180 days for timelapse and NAS storage.
- PC, iPhone, presence, media activity, individual plants, and video-library content stay out of LeDashboard.
- The Raspberry Pi must not appear in active sources, copy, configuration, or the UI.
- Mac metrics must describe native macOS; the Apple Container VM exporter is removed only after Telegraf is verified.
- Failed collections create gaps, never zero-valued samples.
- One failed service check is degraded, two failures open an incident, and two successes close it.
- Raw samples are retained for 7 days, five-minute rollups for 30 days, hourly rollups and incidents for 180 days.
- Secrets remain in deployment-only files and never enter Git or browser responses.
- Preserve unrelated local modifications and untracked files in all three repositories.

---

## File Structure

### `/Users/fvalade/Workspace/LaPlante`

- `packages/shared/src/types.ts`: shared `DashboardSummary` response.
- `apps/server/src/db/queries.ts`: latest global watering query.
- `apps/server/src/services/dashboard-summary.ts`: overdue-count calculation.
- `apps/server/src/routes/dashboard-summary.ts`: read-only summary endpoint.
- `apps/server/src/app.ts`: route registration.
- `apps/server/src/test/dashboard-summary.routes.test.ts`: endpoint behavior.

### `/Users/fvalade/Workspace/LeTimelapse`

- `packages/shared/src/types.ts`: capture and library status response.
- `apps/server/src/capture/heartbeat.ts`: atomic heartbeat persistence.
- `apps/server/src/capture/capture.ts`: success/error heartbeat updates.
- `apps/server/src/routes/status.ts`: read-only status endpoint.
- `apps/server/src/app.ts`: status route dependencies.
- `apps/server/test/status.test.ts`: status and filesystem aggregation.
- `apps/server/package.json`: run all server tests.

### `/Users/fvalade/Workspace/LeDashboard`

- `packages/shared/src/types.ts`: stable metric keys and dashboard API types.
- `apps/server/src/db/client.ts`: clean v2 SQLite schema.
- `apps/server/src/db/repository.ts`: samples, current values, sources, services, and incidents.
- `apps/server/src/services/retention.ts`: rollups and tiered pruning.
- `apps/server/src/config.ts`: curated YAML schema and environment interpolation.
- `apps/server/src/collectors/types.ts`: collector contract.
- `apps/server/src/collectors/home-assistant.ts`: comfort and weather facts.
- `apps/server/src/collectors/house-apps.ts`: LaPlante and LeTimelapse collectors.
- `apps/server/src/collectors/prometheus.ts`: Telegraf and QNAP metric parsing.
- `apps/server/src/collectors/availability.ts`: health checks and latency.
- `apps/server/src/services/source-manager.ts`: isolated schedules and status updates.
- `apps/server/src/services/incidents.ts`: deterministic incident transitions.
- `apps/server/src/routes/dashboard.ts`: curated dashboard response.
- `apps/server/src/routes/series.ts`: expanded historical series.
- `apps/server/src/routes/incidents.ts`: incident history.
- `apps/server/src/app.ts`: v2 composition and compatibility routes.
- `apps/server/sources.yaml.example`: live topology without secrets.
- `apps/server/test/*.test.ts`: repository, retention, collectors, incidents, and API tests.
- `apps/web/src/lib/api.ts`: dashboard API client.
- `apps/web/src/hooks/useDashboard.ts`: refresh and partial-success state.
- `apps/web/src/components/EditorialDashboard/*`: panorama composition.
- `apps/web/src/components/HouseChart/*`: accessible chart rendering.
- `apps/web/src/styles/tokens.css`: natural-light visual tokens.
- `apps/web/src/App.tsx`: new application entry.
- `apps/web/src/App.module.css`: responsive shell.
- `apps/web/src/test/DashboardPage.test.tsx`: UI states.
- `playwright.config.ts` and `e2e/dashboard.spec.ts`: browser acceptance.
- `deploy/macmini/telegraf.conf`: native macOS inputs and Prometheus endpoint.
- `deploy/macmini/run-telegraf.sh`: credential-aware native launcher.
- `deploy/macmini/com.fvalade.telegraf.plist`: LaunchAgent definition.
- `deploy/nas/node-exporter.compose.yaml`: host-aware QNAP exporter.

---

### Task 1: Add the LaPlante dashboard summary contract

**Files:**
- Modify: `/Users/fvalade/Workspace/LaPlante/packages/shared/src/types.ts`
- Modify: `/Users/fvalade/Workspace/LaPlante/apps/server/src/db/queries.ts`
- Create: `/Users/fvalade/Workspace/LaPlante/apps/server/src/services/dashboard-summary.ts`
- Create: `/Users/fvalade/Workspace/LaPlante/apps/server/src/routes/dashboard-summary.ts`
- Modify: `/Users/fvalade/Workspace/LaPlante/apps/server/src/app.ts`
- Create: `/Users/fvalade/Workspace/LaPlante/apps/server/src/test/dashboard-summary.routes.test.ts`

**Interfaces:**
- Consumes: existing `PlantWithRecurrence`, `listPlantsWithRecurrence`, `listWateringEvents`, and `buildScheduleSummary`.
- Produces: `GET /api/dashboard-summary -> DashboardSummary` where `DashboardSummary = { overdueCount: number; lastWateredOn: ISODateString | null }`.

- [ ] **Step 1: Write the failing route test**

```ts
it("returns only overdue count and latest watering", async () => {
  const { app, cleanup } = createTestApp({ today: "2026-05-20" });
  await createPlant(app, "Monstera", 7, "2026-05-01");
  await createPlant(app, "Menthe", 30, "2026-05-18");

  const response = await app.inject({
    method: "GET",
    url: "/api/dashboard-summary",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    overdueCount: 1,
    lastWateredOn: "2026-05-18",
  });
  await app.close();
  cleanup();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --workspace @laplante/server test -- dashboard-summary.routes.test.ts`

Expected: FAIL because `/api/dashboard-summary` returns 404.

- [ ] **Step 3: Add the shared type, query, service, and route**

```ts
export type DashboardSummary = {
  overdueCount: number;
  lastWateredOn: ISODateString | null;
};
```

```ts
export function getLatestWateringDate(db: AppDatabase): ISODateString | null {
  return db
    .select({ wateredOn: wateringEvents.wateredOn })
    .from(wateringEvents)
    .orderBy(desc(wateringEvents.wateredOn))
    .limit(1)
    .get()?.wateredOn ?? null;
}
```

```ts
export function getDashboardSummary(
  db: AppDatabase,
  today: ISODateString,
): DashboardSummary {
  const overdueCount = listPlantsWithRecurrence(db).filter((plant) => {
    const lastWateredOn = listWateringEvents(db, plant.id)[0]?.wateredOn ?? today;
    return buildScheduleSummary({
      intervalDays: plant.intervalDays,
      lastWateredOn,
      today,
      window: { from: today, to: today },
    }).isOverdue;
  }).length;
  return { overdueCount, lastWateredOn: getLatestWateringDate(db) };
}
```

Register a `GET /api/dashboard-summary` route that calls this service with the
same injected `today` used by the plant routes.

```ts
export async function registerDashboardSummaryRoute(
  app: FastifyInstance,
  options: { db: AppDatabase; today?: string },
): Promise<void> {
  app.get("/api/dashboard-summary", async () =>
    getDashboardSummary(
      options.db,
      (options.today ?? todayISO()) as ISODateString,
    ),
  );
}
```

- [ ] **Step 4: Run LaPlante verification**

Run: `npm test`

Expected: all Vitest tests pass, including the new summary route.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit the LaPlante contract**

```bash
git add packages/shared/src/types.ts apps/server/src/db/queries.ts apps/server/src/services/dashboard-summary.ts apps/server/src/routes/dashboard-summary.ts apps/server/src/app.ts apps/server/src/test/dashboard-summary.routes.test.ts
git commit -m "feat: expose plant dashboard summary"
```

---

### Task 2: Add LeTimelapse capture heartbeat and status

**Files:**
- Modify: `/Users/fvalade/Workspace/LeTimelapse/packages/shared/src/types.ts`
- Create: `/Users/fvalade/Workspace/LeTimelapse/apps/server/src/capture/heartbeat.ts`
- Modify: `/Users/fvalade/Workspace/LeTimelapse/apps/server/src/capture/capture.ts`
- Create: `/Users/fvalade/Workspace/LeTimelapse/apps/server/src/routes/status.ts`
- Modify: `/Users/fvalade/Workspace/LeTimelapse/apps/server/src/app.ts`
- Modify: `/Users/fvalade/Workspace/LeTimelapse/apps/server/package.json`
- Create: `/Users/fvalade/Workspace/LeTimelapse/apps/server/test/status.test.ts`

**Interfaces:**
- Consumes: `timelapsePath`, `videosPath`, and `frameInterval` from server config.
- Produces: `GET /api/status -> TimelapseStatusResponse` exactly matching the approved spec.

- [ ] **Step 1: Write failing heartbeat and route tests**

```ts
test("writes heartbeat atomically and reports library size", async () => {
  const root = mkdtempSync(join(tmpdir(), "letimelapse-status-"));
  const videosPath = join(root, "videos");
  mkdirSync(videosPath, { recursive: true });
  writeFileSync(join(videosPath, "2026-07-14.mp4"), Buffer.alloc(1024));
  writeCaptureSuccess(root, 30, new Date("2026-07-14T12:00:00Z"));

  const app = buildApp({
    videosPath,
    timelapsePath: root,
    frameInterval: 30,
    testMode: true,
  });
  const response = await app.inject({ method: "GET", url: "/api/status" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().capture, {
    lastSuccessAt: "2026-07-14T12:00:00.000Z",
    lastErrorAt: null,
    lastError: null,
    expectedIntervalSeconds: 30,
  });
  assert.equal(response.json().library.totalBytes, 1024);
  await app.close();
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --workspace @letimelapse/server test -- status.test.ts`

Expected: FAIL because `heartbeat.ts` and `/api/status` do not exist.

- [ ] **Step 3: Implement atomic heartbeat persistence**

```ts
export type CaptureHeartbeat = {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  expectedIntervalSeconds: number;
};

function heartbeatPath(root: string): string {
  return join(root, "capture-status.json");
}

function writeHeartbeat(root: string, heartbeat: CaptureHeartbeat): void {
  mkdirSync(root, { recursive: true });
  const target = heartbeatPath(root);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(heartbeat));
  renameSync(temporary, target);
}
```

Export `writeCaptureSuccess`, `writeCaptureError`, and `readCaptureHeartbeat`.
Preserve the opposite timestamp when writing one side of the heartbeat. Call
`writeCaptureSuccess` immediately after each JPEG write and
`writeCaptureError` when ffmpeg exits unexpectedly or capture throws.

- [ ] **Step 4: Implement the status route and shared response**

```ts
export interface TimelapseStatusResponse {
  capture: CaptureHeartbeat;
  library: {
    totalBytes: number;
    videoCount: number;
    lastVideoAt: string | null;
  };
}
```

The route scans only top-level `.mp4` files, sums `statSync(file).size`, counts
them, and uses the newest `mtime` for `lastVideoAt`. A missing heartbeat returns
all nullable capture timestamps as `null` while preserving the configured
interval.

- [ ] **Step 5: Run LeTimelapse verification**

Change the server test script to `tsx --test test/*.test.ts`.

Run: `npm --workspace @letimelapse/server test`

Expected: both video and status tests pass.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit LeTimelapse telemetry**

```bash
git add packages/shared/src/types.ts apps/server/src/capture/heartbeat.ts apps/server/src/capture/capture.ts apps/server/src/routes/status.ts apps/server/src/app.ts apps/server/package.json apps/server/test/status.test.ts
git commit -m "feat: expose timelapse capture status"
```

---

### Task 3: Create the LeDashboard v2 data contracts and database

**Files:**
- Modify: `/Users/fvalade/Workspace/LeDashboard/package.json`
- Modify: `/Users/fvalade/Workspace/LeDashboard/package-lock.json`
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/packages/shared/src/types.ts`
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/db/client.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/db/repository.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/repository.test.ts`

**Interfaces:**
- Consumes: a fresh database path ending in `ledashboard-v2.sqlite`.
- Produces: stable `MetricKey`, `CurrentValueKey`, `DashboardResponse`, and `MetricsRepository` APIs used by every later dashboard task.

- [ ] **Step 1: Add the test dependencies and failing repository test**

Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, and
`@playwright/test` as root development dependencies with `npm install -D`.

```ts
it("stores idempotent samples and typed current values", () => {
  const ctx = createDatabase(temporaryDatabasePath());
  const repository = new MetricsRepository(ctx.sqlite);
  repository.insertSamples([
    { key: "comfort.indoor_temperature", ts: 100, value: 22.5 },
    { key: "comfort.indoor_temperature", ts: 100, value: 22.5 },
  ]);
  repository.setCurrentValues([
    { key: "weather.condition", ts: 100, textValue: "partlycloudy" },
  ]);

  expect(repository.getSeries("comfort.indoor_temperature", 0, 200, "raw"))
    .toEqual([{ ts: 100, avg: 22.5, min: 22.5, max: 22.5 }]);
  expect(repository.getCurrentValue("weather.condition")?.textValue)
    .toBe("partlycloudy");
  ctx.sqlite.close();
});
```

- [ ] **Step 2: Run the repository test and verify RED**

Run: `npm test -- apps/server/test/repository.test.ts`

Expected: FAIL because the v2 repository is missing.

- [ ] **Step 3: Define exact shared keys and response types**

```ts
export const METRIC_KEYS = [
  "comfort.indoor_temperature",
  "comfort.outdoor_temperature",
  "comfort.climate_target",
  "weather.humidity",
  "weather.pressure",
  "weather.wind_speed",
  "plants.overdue_count",
  "timelapse.library_bytes",
  "mac.cpu_percent",
  "mac.memory_percent",
  "mac.disk_percent",
  "mac.network_receive_bps",
  "mac.network_transmit_bps",
  "nas.storage_used_bytes",
  "nas.storage_total_bytes",
  "services.available_percent",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type CurrentValueKey =
  | "weather.condition"
  | "plants.last_watered_on"
  | "timelapse.capture_last_success_at"
  | "timelapse.capture_last_error_at"
  | "timelapse.capture_last_error"
  | "timelapse.capture_expected_interval_seconds";

export type ChartId =
  | "comfort"
  | "plants"
  | "timelapseStorage"
  | "macResources"
  | "macNetwork"
  | "nasStorage"
  | "availability";

export type DashboardSeries = {
  key: MetricKey;
  name: string;
  unit: string;
  samples: Sample[];
};

export type DashboardChart = {
  id: ChartId;
  title: string;
  windowSeconds: number;
  series: DashboardSeries[];
};

export type DashboardResponse = {
  generatedAt: string;
  overallState: "healthy" | "degraded" | "down";
  charts: Record<ChartId, DashboardChart>;
  facts: Partial<Record<CurrentValueKey, CurrentValue>>;
  sources: Record<string, SourceFreshness>;
  activeIncidents: Incident[];
};

export type Sample = { ts: number; avg: number; min: number; max: number };
export type CurrentValue = {
  key: CurrentValueKey;
  ts: number;
  numericValue: number | null;
  textValue: string | null;
};
export type Incident = {
  id: number;
  serviceId: string;
  startedAt: string;
  endedAt: string | null;
  lastError: string | null;
};
export type SourceFreshness = {
  state: "fresh" | "stale" | "error";
  lastSuccessAt: string | null;
  lastError: string | null;
};
```

Use Unix seconds for sample timestamps and ISO strings for event timestamps.

- [ ] **Step 4: Create the clean v2 schema and repository**

```sql
CREATE TABLE IF NOT EXISTS metric_definitions (
  key TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  kind TEXT NOT NULL,
  stale_after_seconds INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS samples_raw (
  metric_key TEXT NOT NULL REFERENCES metric_definitions(key),
  ts INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (metric_key, ts)
);
CREATE TABLE IF NOT EXISTS samples_rollup (
  metric_key TEXT NOT NULL REFERENCES metric_definitions(key),
  bucket_seconds INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  avg REAL NOT NULL,
  min REAL NOT NULL,
  max REAL NOT NULL,
  PRIMARY KEY (metric_key, bucket_seconds, ts)
);
CREATE TABLE IF NOT EXISTS current_values (
  key TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  numeric_value REAL,
  text_value TEXT
);
CREATE TABLE IF NOT EXISTS source_state (
  source_id TEXT PRIMARY KEY,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS service_state (
  service_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  latency_ms REAL,
  consecutive_failures INTEGER NOT NULL,
  consecutive_successes INTEGER NOT NULL,
  active_incident_id INTEGER
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_error TEXT
);
```

Register all 16 definitions at startup. `insertSamples` uses
`INSERT OR IGNORE` inside one transaction. `getSeries` selects raw, 300-second,
or 3600-second storage explicitly.

- [ ] **Step 5: Run repository verification**

Run: `npm test -- apps/server/test/repository.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit the v2 foundation**

```bash
git add package.json package-lock.json packages/shared/src/types.ts apps/server/src/db/client.ts apps/server/src/db/repository.ts apps/server/test/repository.test.ts
git commit -m "feat: add curated metrics storage"
```

---

### Task 4: Implement 7/30/180-day rollups and pruning

**Files:**
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/services/retention.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/retention.test.ts`

**Interfaces:**
- Consumes: `MetricsRepository` raw samples.
- Produces: `runRetention(sqlite, nowSeconds)` and `resolutionForRange(rangeSeconds)`.

- [ ] **Step 1: Write failing boundary and rollup tests**

```ts
it("rolls up before pruning each tier", () => {
  const now = 20_000_000;
  seedRawSamples(sqlite, "mac.cpu_percent", now - 8 * DAY, 12);
  runRetention(sqlite, now);

  expect(countRawBefore(sqlite, now - 7 * DAY)).toBe(0);
  expect(countRollups(sqlite, 300)).toBeGreaterThan(0);
  expect(countRollups(sqlite, 3600)).toBeGreaterThan(0);
});

it("selects raw, five-minute, and hourly resolution", () => {
  expect(resolutionForRange(2 * DAY)).toBe("raw");
  expect(resolutionForRange(20 * DAY)).toBe("5m");
  expect(resolutionForRange(180 * DAY)).toBe("1h");
});
```

- [ ] **Step 2: Run the retention test and verify RED**

Run: `npm test -- apps/server/test/retention.test.ts`

Expected: FAIL against the current 90-day delete-only implementation.

- [ ] **Step 3: Implement transactional rollups**

Use one transaction in this order:

```sql
INSERT INTO samples_rollup(metric_key, bucket_seconds, ts, avg, min, max)
SELECT metric_key, 300, (ts / 300) * 300, AVG(value), MIN(value), MAX(value)
FROM samples_raw
GROUP BY metric_key, (ts / 300) * 300
ON CONFLICT(metric_key, bucket_seconds, ts) DO UPDATE SET
  avg = excluded.avg, min = excluded.min, max = excluded.max;

INSERT INTO samples_rollup(metric_key, bucket_seconds, ts, avg, min, max)
SELECT metric_key, 3600, (ts / 3600) * 3600, AVG(value), MIN(value), MAX(value)
FROM samples_raw
GROUP BY metric_key, (ts / 3600) * 3600
ON CONFLICT(metric_key, bucket_seconds, ts) DO UPDATE SET
  avg = excluded.avg, min = excluded.min, max = excluded.max;
```

Then delete raw samples older than 7 days, 300-second rows older than 30 days,
3600-second rows older than 180 days, and ended incidents older than 180 days.

- [ ] **Step 4: Verify retention**

Run: `npm test -- apps/server/test/retention.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit retention**

```bash
git add apps/server/src/services/retention.ts apps/server/test/retention.test.ts
git commit -m "feat: add tiered metrics retention"
```

---

### Task 5: Add curated configuration and isolated collector scheduling

**Files:**
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/config.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/collectors/types.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/services/source-manager.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/config.test.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/source-manager.test.ts`

**Interfaces:**
- Consumes: YAML with `homeAssistant`, `laPlante`, `leTimelapse`, `mac`, `nas`, and `services` sections.
- Produces: `Collector.collect(): Promise<CollectionResult>` and a manager that never reports an empty required collection as healthy.

- [ ] **Step 1: Write failing interpolation and empty-result tests**

```ts
it("interpolates deployment secrets before validation", () => {
  process.env.HA_TOKEN = "secret-token";
  expect(interpolateEnv("token: ${HA_TOKEN}")).toBe("token: secret-token");
});

it("marks an empty required collection as failed", async () => {
  const collector = fakeCollector({ samples: [], currentValues: [] });
  await expect(manager.runOnce(collector)).rejects.toThrow(
    "home-assistant returned no required samples",
  );
  expect(repository.getSourceState("home-assistant")?.lastError).toContain(
    "no required samples",
  );
});
```

- [ ] **Step 2: Run both tests and verify RED**

Run: `npm test -- apps/server/test/config.test.ts apps/server/test/source-manager.test.ts`

Expected: FAIL because interpolation and the v2 manager do not exist.

- [ ] **Step 3: Implement exact collector contracts**

```ts
export type MetricSampleInput = { key: MetricKey; ts: number; value: number };
export type CurrentValueInput = {
  key: CurrentValueKey;
  ts: number;
  numericValue?: number;
  textValue?: string;
};
export type CollectionResult = {
  samples: MetricSampleInput[];
  currentValues: CurrentValueInput[];
};
export interface Collector {
  readonly id: string;
  readonly intervalSeconds: number;
  readonly requiresSamples: boolean;
  collect(): Promise<CollectionResult>;
}
```

`interpolateEnv` uses `/\$\{([A-Z0-9_]+)\}/g` and throws with the variable name
when an environment value is missing. The manager records attempt, validates
required sample count, commits collection and success together, and catches each
collector independently. `stop()` clears every interval.

- [ ] **Step 4: Verify configuration and scheduling**

Run: `npm test -- apps/server/test/config.test.ts apps/server/test/source-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit collector infrastructure**

```bash
git add apps/server/src/config.ts apps/server/src/collectors/types.ts apps/server/src/services/source-manager.ts apps/server/test/config.test.ts apps/server/test/source-manager.test.ts
git commit -m "feat: add curated source scheduling"
```

---

### Task 6: Implement Home Assistant, LaPlante, and LeTimelapse collectors

**Files:**
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/collectors/home-assistant.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/collectors/house-apps.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/home-assistant.collector.test.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/house-apps.collector.test.ts`

**Interfaces:**
- Consumes: live contracts from Tasks 1 and 2 and Home Assistant entities `climate.air_conditioner` and `weather.forecast_maison`.
- Produces: comfort, weather, plants, timelapse samples, and supporting current values.

- [ ] **Step 1: Write failing parser tests**

```ts
it("requires all three comfort temperatures", async () => {
  const collector = new HomeAssistantCollector(config, fetchFixture({
    climate: { state: "off", attributes: { current_temperature: 28.5, temperature: 25 } },
    weather: { state: "partlycloudy", attributes: { humidity: 42 } },
  }));
  await expect(collector.collect()).rejects.toThrow(
    "weather.forecast_maison.temperature is not numeric",
  );
});

it("maps house summaries without detail duplication", async () => {
  const result = await collectHouseApps({
    plants: { overdueCount: 2, lastWateredOn: "2026-07-13" },
    timelapse: {
      capture: { lastSuccessAt: "2026-07-14T12:00:00Z", lastErrorAt: null, lastError: null, expectedIntervalSeconds: 30 },
      library: { totalBytes: 2048, videoCount: 40, lastVideoAt: "2026-07-13T23:58:00Z" },
    },
  });
  expect(result.samples.map((sample) => sample.key)).toEqual([
    "plants.overdue_count",
    "timelapse.library_bytes",
  ]);
});
```

- [ ] **Step 2: Run collector tests and verify RED**

Run: `npm test -- apps/server/test/home-assistant.collector.test.ts apps/server/test/house-apps.collector.test.ts`

Expected: FAIL because these collectors do not exist.

- [ ] **Step 3: Implement the Home Assistant collector**

Fetch the climate and weather state endpoints with bearer authentication. Use a
strict numeric helper:

```ts
function requiredNumber(value: unknown, field: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${field} is not numeric`);
  return numeric;
}
```

Emit the three required temperature samples. Emit humidity, pressure, and wind
only when numeric. Store weather state as `weather.condition`. Do not catch
per-entity errors inside the collector; let the manager mark the source failed.

- [ ] **Step 4: Implement house-app collectors**

The LaPlante collector polls hourly and emits only `plants.overdue_count` plus
`plants.last_watered_on`. The LeTimelapse collector polls every five minutes and
emits only `timelapse.library_bytes` plus capture current values. Both reject
non-2xx responses and validate response shapes with Zod.

- [ ] **Step 5: Verify and commit domain collectors**

Run: `npm test -- apps/server/test/home-assistant.collector.test.ts apps/server/test/house-apps.collector.test.ts`

Expected: PASS.

```bash
git add apps/server/src/collectors/home-assistant.ts apps/server/src/collectors/house-apps.ts apps/server/test/home-assistant.collector.test.ts apps/server/test/house-apps.collector.test.ts
git commit -m "feat: collect house-life metrics"
```

---

### Task 7: Implement native Mac and NAS Prometheus collection

**Files:**
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/collectors/prometheus.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/prometheus.collector.test.ts`

**Interfaces:**
- Consumes: Telegraf Prometheus text and node exporter 1.11.1 text.
- Produces: six Mac series and two NAS storage series with no dynamic metric definitions.

- [ ] **Step 1: Write failing deterministic parsing tests**

```ts
it("maps Telegraf fields and converts counters to rates", async () => {
  const collector = new MacMetricsCollector(config, fixtureFetch([
    "cpu_usage_active 38",
    "mem_used_percent 61",
    "disk_used_percent{path=\"/\"} 42",
    "net_bytes_recv{interface=\"en0\"} 1000",
    "net_bytes_sent{interface=\"en0\"} 500",
  ].join("\n")), () => 100);
  await collector.collect();
  setFixture([
    "cpu_usage_active 39",
    "mem_used_percent 62",
    "disk_used_percent{path=\"/\"} 42",
    "net_bytes_recv{interface=\"en0\"} 1600",
    "net_bytes_sent{interface=\"en0\"} 800",
  ].join("\n"));
  const second = await collector.collectAt(110);
  expect(value(second, "mac.network_receive_bps")).toBe(60);
  expect(value(second, "mac.network_transmit_bps")).toBe(30);
});

it("selects only the QNAP main data volume", async () => {
  const result = await collectNasFixture(
    'node_filesystem_size_bytes{mountpoint="/share/CACHEDEV1_DATA"} 10000\n' +
    'node_filesystem_avail_bytes{mountpoint="/share/CACHEDEV1_DATA"} 7000\n',
  );
  expect(value(result, "nas.storage_used_bytes")).toBe(3000);
});
```

- [ ] **Step 2: Run the Prometheus test and verify RED**

Run: `npm test -- apps/server/test/prometheus.collector.test.ts`

Expected: FAIL because curated Prometheus collectors do not exist.

- [ ] **Step 3: Implement strict parsing and reset-safe rates**

Parse only the named metrics and exact configured labels. Keep previous network
counters in memory. The first observation emits no rate. A lower next counter is
a reset and also emits no rate. Clamp CPU, memory, and disk percentages to the
closed range 0 through 100. Reject responses missing any required Mac gauge or
either NAS filesystem value.

- [ ] **Step 4: Verify and commit infrastructure collectors**

Run: `npm test -- apps/server/test/prometheus.collector.test.ts`

Expected: PASS.

```bash
git add apps/server/src/collectors/prometheus.ts apps/server/test/prometheus.collector.test.ts
git commit -m "feat: collect native host metrics"
```

---

### Task 8: Implement availability and incident state transitions

**Files:**
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/services/incidents.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/collectors/availability.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/incidents.test.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/availability.collector.test.ts`

**Interfaces:**
- Consumes: configured service URL, expected status codes, timeout, and latency threshold.
- Produces: `services.available_percent`, current service states, and incident rows.

- [ ] **Step 1: Write the complete transition test**

```ts
it("opens after two failures and closes after two successes", () => {
  applyCheck(repository, "plex", failure("timeout"), "2026-07-14T10:00:00Z");
  expect(state(repository, "plex").state).toBe("degraded");
  applyCheck(repository, "plex", failure("timeout"), "2026-07-14T10:01:00Z");
  expect(state(repository, "plex").state).toBe("down");
  expect(activeIncidents(repository)).toHaveLength(1);
  applyCheck(repository, "plex", success(22), "2026-07-14T10:02:00Z");
  expect(state(repository, "plex").state).toBe("recovering");
  applyCheck(repository, "plex", success(20), "2026-07-14T10:03:00Z");
  expect(state(repository, "plex").state).toBe("up");
  expect(activeIncidents(repository)).toHaveLength(0);
});
```

- [ ] **Step 2: Run incident tests and verify RED**

Run: `npm test -- apps/server/test/incidents.test.ts apps/server/test/availability.collector.test.ts`

Expected: FAIL because transition logic and checker do not exist.

- [ ] **Step 3: Implement bounded checks and aggregate percentage**

Use `AbortSignal.timeout(timeoutMs)` for each request. A status is healthy only
when included in `expectedStatuses`. Latency above `latencyThresholdMs` is
recorded as slow but available. After all checks, emit:

```ts
{
  key: "services.available_percent",
  ts,
  value: checks.length === 0 ? 0 : (healthyCount / checks.length) * 100,
}
```

Do not open incidents for slow-only results. Persist transitions and incident
updates in one transaction per service.

- [ ] **Step 4: Verify and commit availability**

Run: `npm test -- apps/server/test/incidents.test.ts apps/server/test/availability.collector.test.ts`

Expected: PASS.

```bash
git add apps/server/src/services/incidents.ts apps/server/src/collectors/availability.ts apps/server/test/incidents.test.ts apps/server/test/availability.collector.test.ts
git commit -m "feat: track house service availability"
```

---

### Task 9: Build the curated dashboard API

**Files:**
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/routes/dashboard.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/routes/series.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/routes/incidents.ts`
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/server/src/app.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/server/test/dashboard.routes.test.ts`

**Interfaces:**
- Consumes: repository, source manager, incident service, and fixed metric keys.
- Produces: `/api/dashboard`, `/api/series/:key`, `/api/incidents`, and diagnostic `/api/sources`.

- [ ] **Step 1: Write a failing partial-success API test**

```ts
it("returns healthy charts when one source is stale", async () => {
  seedComfort(repository, now);
  repository.recordSourceFailure("nas", "connection refused", nowIso);
  const response = await app.inject({ method: "GET", url: "/api/dashboard" });
  expect(response.statusCode).toBe(200);
  expect(response.json().charts.comfort.series).toHaveLength(3);
  expect(response.json().charts.nasStorage.series[0].samples).toEqual([]);
  expect(response.json().sources.nas.state).toBe("error");
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `npm test -- apps/server/test/dashboard.routes.test.ts`

Expected: FAIL because `/api/dashboard` is absent.

- [ ] **Step 3: Implement fixed chart assembly**

Create a constant chart definition for the seven approved cards. Resolve each
default window independently, select raw/5m/1h using `resolutionForRange`, and
return empty series for missing sources. Include current weather, last watering,
capture freshness, active incidents, and generated timestamp. Calculate NAS
growth by linear regression over the latest 30 complete daily-equivalent hourly
samples; omit the projection before seven complete days or for non-positive
slopes.

- [ ] **Step 4: Implement freshness and capture state**

`fresh`, `stale`, and `error` are derived from `last_success_at`, `last_error`,
and each definition's `stale_after_seconds`. Timelapse is degraded at three
missed expected intervals and down at six intervals or when the latest error is
newer than the latest success.

- [ ] **Step 5: Verify the complete server**

Run: `npm test -- apps/server/test`

Expected: all server Vitest tests pass.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit the API**

```bash
git add apps/server/src/routes/dashboard.ts apps/server/src/routes/series.ts apps/server/src/routes/incidents.ts apps/server/src/app.ts apps/server/test/dashboard.routes.test.ts
git commit -m "feat: expose curated dashboard API"
```

---

### Task 10: Build the Editorial Panorama React interface

**Files:**
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/lib/api.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/hooks/useDashboard.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/components/HouseChart/HouseChart.tsx`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/components/HouseChart/HouseChart.module.css`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/components/EditorialDashboard/EditorialDashboard.tsx`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/components/EditorialDashboard/EditorialDashboard.module.css`
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/App.tsx`
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/App.module.css`
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/styles/tokens.css`
- Create: `/Users/fvalade/Workspace/LeDashboard/apps/web/src/test/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `DashboardResponse` from Task 9.
- Produces: responsive approved panorama with explicit stale, partial, and incident states.

- [ ] **Step 1: Write failing UI-state tests**

```tsx
// @vitest-environment jsdom
it("renders the seven curated chart titles and stale context", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
    JSON.stringify(fixtureWithStaleNas),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )));
  render(<App />);
  expect(await screen.findByText("Confort")).toBeVisible();
  expect(screen.getByText("Plantes en retard")).toBeVisible();
  expect(screen.getByText("Bibliothèque timelapse")).toBeVisible();
  expect(screen.getByText("Ressources du Mac mini")).toBeVisible();
  expect(screen.getByText("Réseau du Mac mini")).toBeVisible();
  expect(screen.getByText("Stockage du NAS")).toBeVisible();
  expect(screen.getByText("Disponibilité")).toBeVisible();
  expect(screen.getByText(/NAS · données anciennes/)).toBeVisible();
  expect(screen.queryByText(/Raspberry/i)).toBeNull();
});
```

- [ ] **Step 2: Run the UI test and verify RED**

Run: `npm test -- apps/web/src/test/DashboardPage.test.tsx`

Expected: FAIL against the generic category dashboard.

- [ ] **Step 3: Implement the dashboard hook and partial refresh**

```ts
export function useDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      setData(await fetchDashboard(signal));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible");
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);
  return { data, error, refreshing, retry: refresh };
}
```

- [ ] **Step 4: Implement the approved panorama composition**

`EditorialDashboard` renders a header with overall state, a two-column hero with
the comfort chart and current weather, a two-card household row for plants and
timelapse, then an infrastructure section containing Mac resources, Mac network,
NAS storage, and availability. Each card receives a fixed chart object; there is
no category navigation or overlay picker.

`HouseChart` uses Recharts with `connectNulls={false}`, visible legends for
multi-series charts, unit-aware tooltips, keyboard-focusable card summaries, and
`isAnimationActive={false}` under reduced motion. Use one Y axis for equal units;
the comfort chart's three series are all Celsius.

- [ ] **Step 5: Implement Natural Light styling**

Use these exact core tokens and responsive layout:

```css
:root {
  --house-canvas: #f1efe7;
  --house-surface: rgba(255, 255, 255, 0.78);
  --house-ink: #1a2d24;
  --house-muted: #718078;
  --house-green: #246d4e;
  --house-green-soft: #dcecdf;
  --house-border: rgba(42, 74, 57, 0.14);
  --house-warning: #ad6b27;
  --house-error: #a9473f;
  --house-radius: 18px;
}
.panorama { display: grid; gap: 18px; }
.hero { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(260px, .72fr); gap: 18px; }
.household, .infrastructure { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
@media (max-width: 800px) {
  .hero, .household, .infrastructure { grid-template-columns: 1fr; }
}
```

Use the existing LaMaison-compatible body font and a Georgia serif stack for
large readings and section headings. Do not add a remote font dependency.

- [ ] **Step 6: Verify web behavior and commit**

Run: `npm test -- apps/web/src/test/DashboardPage.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: all shared, server, and web builds exit 0.

```bash
git add apps/web/src/lib/api.ts apps/web/src/hooks/useDashboard.ts apps/web/src/components/HouseChart apps/web/src/components/EditorialDashboard apps/web/src/App.tsx apps/web/src/App.module.css apps/web/src/styles/tokens.css apps/web/src/test/DashboardPage.test.tsx
git commit -m "feat: redesign house metrics panorama"
```

---

### Task 11: Add browser acceptance and deployment manifests

**Files:**
- Create: `/Users/fvalade/Workspace/LeDashboard/playwright.config.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/e2e/fixtures/dashboard.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/e2e/dashboard.spec.ts`
- Create: `/Users/fvalade/Workspace/LeDashboard/deploy/macmini/telegraf.conf`
- Create: `/Users/fvalade/Workspace/LeDashboard/deploy/macmini/run-telegraf.sh`
- Create: `/Users/fvalade/Workspace/LeDashboard/deploy/macmini/com.fvalade.telegraf.plist`
- Create: `/Users/fvalade/Workspace/LeDashboard/deploy/nas/node-exporter.compose.yaml`
- Rewrite: `/Users/fvalade/Workspace/LeDashboard/apps/server/sources.yaml.example`
- Modify: `/Users/fvalade/Workspace/LeDashboard/.github/workflows/docker-publish.yml`

**Interfaces:**
- Consumes: compiled dashboard and live topology addresses.
- Produces: reproducible native Telegraf, QNAP exporter, source configuration, and desktop/mobile acceptance checks.

- [ ] **Step 1: Write the failing Playwright acceptance**

```ts
// playwright.config.ts
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "npm --workspace @ledashboard/web run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/ledashboard/",
    reuseExistingServer: !process.env.CI,
  },
});

// dashboard.spec.ts
test("renders the editorial panorama on desktop and mobile", async ({ page }) => {
  await page.route("**/api/dashboard", async (route) => {
    await route.fulfill({ status: 200, json: dashboardFixture });
  });
  await page.goto("/ledashboard/");
  await expect(page.getByRole("heading", { name: "La Maison" })).toBeVisible();
  await expect(page.getByText("Confort")).toBeVisible();
  await expect(page.getByText("Disponibilité")).toBeVisible();
  await expect(page.getByText(/Raspberry/i)).toHaveCount(0);
  await expect(page).toHaveScreenshot("dashboard-desktop.png", { fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("dashboard-mobile.png", { fullPage: true });
});
```

`e2e/fixtures/dashboard.ts` exports one deterministic `DashboardResponse` with
all seven charts, one stale NAS source, and one active incident. This keeps the
visual contract independent from production credentials and collection timing.

- [ ] **Step 2: Run Playwright and verify the initial screenshot failure**

Run: `npx playwright test e2e/dashboard.spec.ts`

Expected: FAIL until the first approved baselines are recorded.

- [ ] **Step 3: Add native Telegraf configuration**

```toml
[agent]
  interval = "60s"
  flush_interval = "60s"
  omit_hostname = true
[[inputs.cpu]]
  percpu = false
  totalcpu = true
  report_active = true
[[inputs.mem]]
[[inputs.disk]]
  mount_points = ["/"]
[[inputs.net]]
  interfaces = ["en0"]
[[inputs.system]]
[[outputs.prometheus_client]]
  listen = "0.0.0.0:9273"
  basic_username = "${TELEGRAF_PROM_USERNAME}"
  basic_password = "${TELEGRAF_PROM_PASSWORD}"
```

`run-telegraf.sh` sources
`/Users/florianvalade/homelab/telegraf/credentials.env` with mode 600 and then
executes `/opt/homebrew/bin/telegraf --config /Users/florianvalade/homelab/telegraf/telegraf.conf`.
The LaunchAgent runs that script with `KeepAlive` and `RunAtLoad`, writing logs
under `/Users/florianvalade/homelab/logs/`.

- [ ] **Step 4: Add the QNAP exporter manifest**

```yaml
services:
  node-exporter:
    image: quay.io/prometheus/node-exporter:v1.11.1
    container_name: nas-node-exporter
    command:
      - --path.rootfs=/host
      - --collector.disable-defaults
      - --collector.filesystem
    network_mode: host
    pid: host
    restart: unless-stopped
    volumes:
      - /:/host:ro,rslave
```

- [ ] **Step 5: Add the exact source example**

Use these endpoints and intervals:

```yaml
homeAssistant:
  url: http://192.168.0.84:8123/api
  token: ${HA_TOKEN}
  intervalSeconds: 300
laPlante:
  url: http://192.168.0.84:3001/api/dashboard-summary
  intervalSeconds: 3600
leTimelapse:
  url: http://192.168.0.84:3003/api/status
  intervalSeconds: 300
mac:
  url: http://192.168.0.84:9273/metrics
  username: ${TELEGRAF_PROM_USERNAME}
  password: ${TELEGRAF_PROM_PASSWORD}
  intervalSeconds: 60
  interface: en0
nas:
  url: http://192.168.0.78:9100/metrics
  intervalSeconds: 300
  mountpoint: /share/CACHEDEV1_DATA
services:
  - { id: lamaison, name: LaMaison, url: http://192.168.0.84/, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: home-assistant, name: Home Assistant, url: http://192.168.0.84:8123/, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: laplante, name: LaPlante, url: http://192.168.0.84:3001/health, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: ledashboard, name: LeDashboard, url: http://127.0.0.1:3002/health, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: letimelapse, name: LeTimelapse, url: http://192.168.0.84:3003/health, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: aion, name: Aion Gateway, url: https://florians-mac-mini.daggertooth-sunfish.ts.net/healthz, expectedStatuses: [200], latencyThresholdMs: 3000 }
  - { id: couchdb, name: CouchDB, url: https://florians-mac-mini.daggertooth-sunfish.ts.net:8443/, expectedStatuses: [401], latencyThresholdMs: 1000, tlsInsecure: true }
  - { id: plex, name: Plex, url: http://192.168.0.78:32400/identity, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: transmission, name: Transmission, url: http://192.168.0.78:9091/transmission/web/, expectedStatuses: [401], latencyThresholdMs: 1000 }
  - { id: sonarr, name: Sonarr, url: http://192.168.0.78:8989/ping, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: radarr, name: Radarr, url: http://192.168.0.78:7878/ping, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: prowlarr, name: Prowlarr, url: http://192.168.0.78:9696/ping, expectedStatuses: [200], latencyThresholdMs: 1000 }
  - { id: overseerr, name: Overseerr, url: http://192.168.0.78:5055/api/v1/status, expectedStatuses: [200], latencyThresholdMs: 1000 }
```

For `tlsInsecure`, use a request-local Node `https.Agent` with
`rejectUnauthorized: false`; never disable TLS verification process-wide.

- [ ] **Step 6: Gate the image build on verification**

Before `docker/build-push-action`, add Node setup, `npm ci`, `npm test`,
`npm run typecheck`, and `npm run build`. The Docker build runs only after all
four commands succeed.

- [ ] **Step 7: Record reviewed screenshots and commit**

Run: `npx playwright test e2e/dashboard.spec.ts --update-snapshots`

Expected: desktop and mobile baselines are created after visual inspection.

Run: `npx playwright test e2e/dashboard.spec.ts`

Expected: PASS with two matching screenshots.

```bash
git add playwright.config.ts e2e deploy apps/server/sources.yaml.example .github/workflows/docker-publish.yml
git commit -m "chore: add dashboard deployment manifests"
```

---

### Task 12: Perform the staged live rollout and update HomeLab documentation

**Files:**
- Modify: `/Users/fvalade/Documents/HomeLab/inventory.md`
- Modify: `/Users/fvalade/Documents/HomeLab/services.md`
- Modify: `/Users/fvalade/Documents/HomeLab/hosts/macmini.md`
- Modify: `/Users/fvalade/Documents/HomeLab/hosts/nashome.md`

**Interfaces:**
- Consumes: tested images and deployment files from Tasks 1 through 11.
- Produces: live, verified curves through LaMaison with rollback artifacts preserved.

- [ ] **Step 1: Verify every repository before publication**

Run in LaPlante: `npm test`, then `npm run typecheck`, then `npm run build`.

Run in LeTimelapse: `npm --workspace @letimelapse/server test`, then
`npm run typecheck`, then `npm run build`.

Run in LeDashboard: `npm test`, then `npm run typecheck`, then `npm run build`,
then `npx playwright test`.

Expected: every command exits 0 with no failing tests.

- [ ] **Step 2: Publish and wait for all three image workflows**

Push the three reviewed branches only after explicit user confirmation. Verify
GitHub Actions completed successfully and the immutable SHA tags exist before
touching production.

- [ ] **Step 3: Deploy and verify LaPlante and LeTimelapse contracts first**

Update their Mac mini Apple Containers to the immutable images. Verify:

```bash
curl -fsS http://127.0.0.1:3001/api/dashboard-summary
curl -fsS http://127.0.0.1:3003/api/status
```

Expected: both return the approved JSON contracts and current timestamps.

- [ ] **Step 4: Install native Telegraf without removing the old exporter**

On the Mac mini, install with `brew install telegraf`, copy the versioned config,
launcher, and LaunchAgent, generate a 48-hex-character password with
`openssl rand -hex 24`, store it with username `ledashboard` in the mode-600
credentials file, bootstrap the LaunchAgent, and verify authenticated `/metrics`
contains `cpu_usage_active`, `mem_used_percent`, and `disk_used_percent` for `/`.

- [ ] **Step 5: Start the QNAP exporter**

Copy the versioned compose file to
`/share/CACHEDEV1_DATA/Container/lamaison-migrated/node-exporter.compose.yaml`,
start it with QNAP Docker Compose, and verify `/metrics` reports
`node_filesystem_size_bytes` for `/share/CACHEDEV1_DATA` close to 9.9 TB.

- [ ] **Step 6: Back up and deploy LeDashboard v2**

Copy the current SQLite database and source YAML to timestamped backup names.
Render the new source config with the Home Assistant and Telegraf secrets. Start
the new dashboard with `DATABASE_PATH=/app/data/ledashboard-v2.sqlite`. Keep the
old database untouched.

- [ ] **Step 7: Verify live collection before exporter removal**

Check `/api/dashboard`, `/api/sources`, `/api/incidents`, and each default chart.
Wait for two Mac samples and confirm network rates appear after the first
counter baseline. Verify the Mac memory total no longer resembles the former
1.16 GB VM. Verify Home Assistant points to `192.168.0.84`, plants and timelapse
are fresh, NAS storage is near 27 percent, and service availability is current.

- [ ] **Step 8: Remove the obsolete Mac node-exporter**

Only after Step 7 passes, stop and remove the Apple Container named
`node-exporter`. Recheck that port 9100 is no longer listening on the Mac mini
and port 9273 still serves authenticated native data.

- [ ] **Step 9: Verify the user-facing route and responsive design**

Open `http://192.168.0.84/ledashboard/` through LaMaison. Capture desktop and
mobile screenshots, confirm all seven charts, verify stale gaps with a temporary
single-source interruption, then restore the source and confirm recovery.

- [ ] **Step 10: Update and verify HomeLab documentation**

Document Telegraf on port 9273, QNAP `nas-node-exporter`, LeDashboard v2,
180-day retention, the removal of the Mac VM exporter, and the live source
topology. Remove active Raspberry and old NAS-dashboard statements. Compare the
final docs against `container list --all`, QNAP `docker ps`, live ports, and API
health before committing.

- [ ] **Step 11: Commit the HomeLab documentation**

```bash
git add inventory.md services.md hosts/macmini.md hosts/nashome.md
git commit -m "docs: update house dashboard topology"
```

## Final Verification Checklist

- [ ] LaPlante summary returns only overdue count and latest watering.
- [ ] LeTimelapse status reports current capture heartbeat and library bytes.
- [ ] Telegraf metrics identify native macOS and use `en0`.
- [ ] QNAP metrics identify `/share/CACHEDEV1_DATA`.
- [ ] LeDashboard source status fails on missing required Home Assistant values.
- [ ] The dashboard renders exactly seven charts and no Raspberry copy.
- [ ] Failed sources create gaps and stale labels, never zeroes.
- [ ] Incident transitions match one-failure degraded, two-failure open, two-success close.
- [ ] Retention tests prove 7-day raw, 30-day five-minute, and 180-day hourly storage.
- [ ] Desktop and mobile Playwright checks pass.
- [ ] LaMaison proxy, API routes, and live browser rendering pass.
- [ ] The old database and deployment configuration remain available for rollback.
