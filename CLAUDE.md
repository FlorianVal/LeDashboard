# LeDashboard — Home Metrics Dashboard

## Purpose

Collects, stores, and visualizes home infrastructure metrics:
- System metrics (CPU, RAM, load, network) from Raspberry Pi and NAS via node_exporter
- Environment metrics (temperature, humidity, battery) from Matter sensors via Home Assistant
- Climate metrics (current/target temp, on/off state), weather (forecast temp, humidity, pressure, wind), iPhone battery — all via Home Assistant REST API

Data retention: 90 days (automatic pruning).

## Architecture

```
apps/web/          React 19 + Vite 6 frontend (SPA)
                   Styling: CSS Modules + design tokens (green botanical palette, matching LaPlante)
                   Charts: recharts (time series with multi-series overlay, dual Y-axis)
                   Components: Dashboard, MetricChartCard, CategoryNav, TimeRangeSelector, SourceStatusBar

apps/server/       Fastify 5 backend (TypeScript)
                   Database: SQLite via better-sqlite3 + Drizzle ORM (WAL mode)
                   Sources: generic adapter pattern for metrics collection
                     - PrometheusAdapter: parses node_exporter /metrics text format
                     - HomeAssistantAdapter: queries HA REST API for sensor states/attributes
                   Collection: polling at configurable intervals
                   Retention: daily pruning of samples older than 90 days

packages/shared/   Shared TypeScript types and date utilities (date-fns, French locale)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/metrics` | List all metric definitions |
| GET | `/api/metrics/:id?from=&to=&window=` | Time series data with auto-aggregation |
| GET | `/api/metrics/categories` | Grouped by category |
| GET | `/api/sources` | Source status (last collected, errors) |

## Configuration

- `sources.yaml` (gitignored, not committed) defines what to collect.
- `apps/server/sources.yaml.example` is the committed template.
- Schema: each source has `id`, `type` (prometheus/home-assistant), `url`, `interval`, and either `metrics[]` (prometheus) or `sensors[]` (HA with optional `attribute` field).

## Deployment

### Container: `florianval/ledashboard:latest`

Multi-arch Docker build (amd64 + arm64) via GitHub Actions (`.github/workflows/docker-publish.yml`).
Uses `network_mode: host` to access node_exporter and Home Assistant on localhost.

### LaMaison (unified web interface)

Repo: `FlorianVal/LaMaison` — nginx-based shell with tabs.
Deployed at `/home/fvalade/lamaison/docker-compose.yml` on the Raspberry Pi.

```
Port 80 (LaMaison nginx):
  /              → tab shell (index.html)
  /ledashboard/  → proxy to localhost:3002 (LeDashboard)
  /api/metrics   → proxy to localhost:3002
  /api/sources   → proxy to localhost:3002

Port 3001 (LaPlante bridge):
  LaPlante container (unchanged, volumes mount existing data)

Port 3002 (LeDashboard host):
  LeDashboard Fastify + SPA
```

Watchtower auto-updates all three containers when new images are pushed to Docker Hub.

### Raspberry Pi specifics

- LeDashboard and LaMaison use `network_mode: host` — required to reach HA and node_exporter on localhost.
- Docker + UFW conflict: iptables rules for ports 80 and 3002 must be added directly (not via UFW).
- iptables rules saved with `netfilter-persistent save` to survive reboots.

## Development

```bash
npm install                     # Install all workspace dependencies
npm --workspace @ledashboard/server run dev    # Backend on :3000
npm --workspace @ledashboard/web run dev       # Frontend on :5173 (proxies /api to :3000)
npm test                        # Run tests
```

## Module resolution gotchas

- Server + shared packages use `NodeNext` module resolution (requires `.js` extensions in imports).
- Web package uses `Bundler` resolution (Vite handles it).
- `insertMetricDef` must use raw SQL (`ctx.sqlite.prepare`) — Drizzle's `onConflictDoUpdate` silently drops rows with different IDs for the same entity_id.
