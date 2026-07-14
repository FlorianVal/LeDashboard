# LaMaison House-Life Dashboard Design

**Date:** 2026-07-14
**Status:** Approved for implementation planning

## Purpose

Replace the current generic metrics browser with a restrained, curve-first
overview of life in the house. LaPlante and LeTimelapse remain the detailed
applications for their own domains. LeDashboard only surfaces trends and
exceptions that are useful across the house.

The dashboard must reflect the live Mac mini-first topology. It must not show
the retired Raspberry Pi, stale Home Assistant entities, Apple Container VM
metrics as if they were macOS host metrics, raw network counters, or every
virtual network interface.

## Goals

- Show seven curated charts with clear default time windows.
- Keep the editorial panorama layout and the natural-light visual atmosphere
  shared by the other LaMaison applications.
- Collect real macOS host metrics through a native exporter.
- Make missing or stale data explicit instead of turning failures into zeroes.
- Keep 180 days of useful history without retaining minute-level data for the
  entire period.
- Monitor the availability of house services while only surfacing active
  incidents and an aggregate trend on the home page.
- Preserve the current LaMaison routes and the Mac mini Apple Container
  deployment model.

## Non-goals

- Showing PC power state, iPhone data, presence, media activity, download
  progress, or recently added media.
- Reproducing individual plant cards or the timelapse video library.
- Building a general-purpose Prometheus or Grafana replacement.
- Monitoring remote office machines such as `server1` and `sake`.
- Displaying every collected field merely because a source exposes it.

## Current Problems

The deployed dashboard still defines `rpi-node`, a NAS exporter that no longer
exists, and a Home Assistant URL on the powered-off Raspberry Pi. The Home
Assistant adapter catches sensor errors internally and returns an empty
collection, which incorrectly lets the source manager mark it healthy.

The current database exposes 182 definitions, including 158 network metrics.
Most are stale interfaces and cumulative counters. The `node-exporter`
container on the Mac mini reports the Apple Container Linux VM, including its
roughly 1.16 GB memory allocation, rather than the macOS host.

## Product Structure

### Header

The header contains the LaMaison title, the overall freshness state, and active
incident count. When everything is current, it uses a quiet `Tout va bien`
indicator. It does not render a permanent row of green service badges.

### Chart 1: Comfort

- Default window: 24 hours.
- Series: indoor temperature, outdoor temperature, and air-conditioner target.
- Current indoor and outdoor values remain visible above the chart.
- Current humidity, pressure, wind, and weather condition appear as supporting
  values, not additional full-size charts.

### Chart 2: Plants

- Default window: 30 days.
- Series: count of overdue plants.
- Supporting annotation: date of the most recent watering event across all
  plants.
- No plant names, photos, schedules, or individual status cards appear here.

### Chart 3: Timelapse Storage

- Default window: 180 days.
- Series: total timelapse library bytes.
- Supporting state: latest successful frame timestamp and capture freshness.
- No video list, preview gallery, or per-period counts appear here.

### Chart 4: Mac mini Resources

- Default window: 24 hours.
- Series: total CPU usage percent, memory usage percent, and root-disk usage
  percent.
- Values come from native macOS Telegraf, not a Linux container VM.

### Chart 5: Mac mini Network

- Default window: 24 hours.
- Series: received and transmitted bytes per second, presented in an automatic
  human-readable rate unit.
- Loopback and virtual/container interfaces are excluded before aggregation.

### Chart 6: NAS Storage

- Default window: 180 days.
- Series: used bytes and projected growth for the main QNAP data volume.
- Supporting value: current percent used.
- The projection is a linear slope over the latest 30 complete days. It appears
  only after seven days of samples and only when growth is positive.
- CPU, memory, and network data are not stored in this version.

### Chart 7: Availability

- Default window: 30 days.
- Series: percentage of monitored services available at each interval.
- Supporting state: active incidents and latency above the configured
  per-service threshold.
- Per-service history stays in the expanded detail view.

## Visual Design

The selected direction is the **Editorial Panorama** with the **Natural Light**
atmosphere:

- warm mineral background rather than a clinical white canvas;
- restrained botanical green for primary data and healthy states;
- a characterful serif for large values and headings, paired with the existing
  application body typography;
- one dominant comfort card, two secondary household trend cards, and a quiet
  infrastructure section below the fold;
- generous spacing, thin borders, subtle tinted chart areas, and limited use of
  shadows;
- no generic category sidebar and no equal-weight grid of arbitrary metrics.

Desktop uses the asymmetric panorama layout. Tablet and mobile collapse to one
column without horizontal scrolling. Charts keep readable axes, tooltips are
keyboard accessible, color is not the only state indicator, and reduced-motion
preferences disable non-essential transitions.

## Runtime Architecture

LaMaison remains the entry portal and continues proxying `/ledashboard/` and the
dashboard API to `macmini-ledashboard` on port 3002. LeDashboard remains a
Fastify, React, and SQLite application deployed in an Apple Container on the Mac
mini.

The LeDashboard server owns collection, normalization, retention, incident
state, and the dashboard API. The browser only receives curated series and
presentation metadata. It never receives Home Assistant, Telegraf, or service
credentials.

### Sources

#### Home Assistant

- URL: the live Mac mini Home Assistant address reachable from the dashboard
  container.
- Poll interval: five minutes.
- Required fields: indoor temperature, climate target, and outdoor temperature.
- Optional supporting fields: humidity, pressure, wind speed, and current
  condition.
- Authentication token: environment interpolation in the deployed source
  configuration, never committed or returned by the API.
- A collection succeeds only when all three required numeric fields are
  present. Optional supporting fields may be absent without failing the source.

#### LaPlante

LaPlante gains a read-only `GET /api/dashboard-summary` route with this
contract:

```json
{
  "overdueCount": 0,
  "lastWateredOn": "2026-07-14"
}
```

The value is collected hourly. `lastWateredOn` is the most recent watering event
across all plants and may be `null` only when no event exists.

#### LeTimelapse

LeTimelapse gains a read-only `GET /api/status` route. The capture process writes
an atomic heartbeat file containing the latest success, latest error, error
message, and expected interval. The server combines it with library filesystem
statistics and returns:

```json
{
  "capture": {
    "lastSuccessAt": "2026-07-14T12:00:00Z",
    "lastErrorAt": null,
    "lastError": null,
    "expectedIntervalSeconds": 30
  },
  "library": {
    "totalBytes": 6012954214,
    "videoCount": 40,
    "lastVideoAt": "2026-07-13T23:58:00Z"
  }
}
```

LeDashboard polls this route every five minutes. Only `totalBytes` becomes a
chart series. Capture fields drive freshness and incident presentation.

#### Native Mac mini Metrics

Install Telegraf through Homebrew and run it as a native macOS service. Enable
only the `cpu`, `mem`, `disk`, `net`, and `system` inputs required by the design.
Expose them with `outputs.prometheus_client` on a Mac mini address reachable by
the Apple Container. Protect the endpoint with basic authentication stored in
deployment-only environment/config files.

The dashboard polls Telegraf every 60 seconds. Disk metrics are restricted to
the macOS root volume. Network counters are restricted to the physical interface
used by the default route, then converted to rates server-side with reset
detection. The existing Apple Container `node-exporter` is removed only after
the native source has passed live collection checks.

#### NAS Metrics

Run the official node exporter on QNAP with host networking and a read-only host
root mount using `--path.rootfs`. LeDashboard polls it through the home LAN every
five minutes. The home-page metric is restricted to the main data volume's used
and total bytes. Virtual mounts and container filesystems are excluded.

#### Availability Checks

LeDashboard probes the active house services every 60 seconds with bounded HTTP
requests. The monitored set is LaMaison, Home Assistant, LaPlante, LeDashboard,
LeTimelapse, Aion Gateway through its public health endpoint, CouchDB through
Caddy, Plex, Transmission, Sonarr, Radarr, Prowlarr, and Overseerr. `ntfy` is
excluded because it has no stable host endpoint in the current topology. Media
content and activity are never collected.

Each check records success, latency, and timestamp. One failure marks a service
degraded. Two consecutive failures open an incident. Two consecutive successes
close it. Each service declares its expected status codes and latency threshold;
authentication responses such as CouchDB or Transmission `401` are healthy only
when explicitly configured.

## Data Model

The clean database uses stable, curated metric keys. It does not dynamically
create definitions from every Prometheus label.

- `metric_definitions`: key, source, display name, unit, kind, and stale
  threshold.
- `samples_raw`: metric key, timestamp, and numeric value with a composite
  uniqueness constraint.
- `samples_rollup`: metric key, bucket width, bucket timestamp, average, minimum,
  and maximum.
- `current_values`: key, timestamp, and either numeric or text value for
  supporting facts such as weather condition, latest watering, and capture
  error.
- `source_state`: latest attempt, latest success, current error, and freshness.
- `service_state`: current result, latency, consecutive success/failure counts,
  and incident link.
- `incidents`: service, start, end, duration, and last error.

An integer or composite key replaces per-sample UUID strings. Collection and
rollup writes are transactional and idempotent.

### Retention

- Raw samples at each source's native collection interval: seven days.
- Five-minute rollups: 30 days.
- Hourly rollups: 180 days.
- Incident records: 180 days.
- Rollups complete before the older source resolution is deleted.

The existing SQLite database is copied to a dated backup before the clean schema
is activated. The old database remains available for rollback but its stale
series are not imported into the new catalogue.

## API Design

- `GET /api/dashboard` returns current values, default-window series for the
  seven charts, supporting weather/capture values, source freshness, and the
  active incident summary.
- `GET /api/series/:key?from=&to=` returns an expanded series at the appropriate
  stored resolution.
- `GET /api/incidents?from=&to=` returns availability incidents for detail views.
- `GET /api/sources` remains available for diagnostics but reports actual
  expected-field collection success rather than merely a completed poll.
- The generic metric-discovery API remains read-only during the rollback window
  and is removed after live acceptance succeeds.

The default dashboard response is partial-success: one missing collector does
not block healthy sections.

## Failure and Freshness Rules

- Failed collections never insert zeroes.
- Missing samples render as chart gaps.
- A stale latest value remains visible with its timestamp and a stale label; it
  is never styled as current.
- Home Assistant, Mac mini, NAS, and availability use source-specific stale
  thresholds derived from their polling intervals.
- Timelapse becomes degraded after three expected capture intervals without a
  successful frame. Six missed intervals, or a latest error newer than the
  latest success, opens a capture incident.
- Each collector has an independent timeout and cannot stop other scheduled
  collection loops.
- Logs include source, duration, sample count, and sanitized error without
  credentials.

## Testing

- Unit tests cover metric filtering, counter-to-rate conversion, counter reset,
  plant overdue summaries, capture freshness, service state transitions, and
  retention boundaries.
- Collector tests use real HTTP parsing against local fake servers, including
  partial and malformed responses.
- Fastify and temporary SQLite integration tests cover initial schema creation,
  idempotent inserts, rollups, pruning, partial dashboard responses, and
  incidents.
- React tests cover current, loading, empty, stale, partial, and incident states.
- Playwright covers desktop and mobile panorama layouts, accessible tooltips,
  default chart windows, and a visual screenshot check.
- Production verification checks native Telegraf identity, removal of the VM
  exporter, QNAP storage collection, source freshness, API responses, database
  growth, and the LaMaison-proxied browser view.

## Deployment and Rollback

1. Add and deploy the LaPlante summary route.
2. Add and deploy the LeTimelapse heartbeat and status route.
3. Install and validate native Telegraf on the Mac mini.
4. Start and validate the host-aware NAS exporter.
5. Back up the deployed LeDashboard SQLite database and source configuration.
6. Deploy the new LeDashboard image and clean database schema.
7. Verify every collector and the LaMaison-proxied UI.
8. Remove the old Mac mini `node-exporter` container only after Telegraf has
   produced real macOS samples.

Rollback restores the previous image, source configuration, and saved SQLite
database. Telegraf and the NAS exporter can remain stopped without affecting
the previous dashboard.

## Acceptance Criteria

- The dashboard contains only the seven approved charts and supporting values.
- No active UI or source names the Raspberry Pi.
- Mac mini values demonstrably describe macOS, not the Apple Container VM.
- Home Assistant collection reports failure when required readings are absent.
- Plant and timelapse cards contain no duplicated detailed content.
- Charts show gaps and stale labels during source failures.
- Availability incidents follow the two-failure/two-success transition rule.
- Raw, five-minute, and hourly retention tiers enforce 7, 30, and 180 days.
- The responsive visual result matches the approved Editorial Panorama and
  Natural Light direction inside LaMaison.
- Live checks through LaMaison confirm data freshness and correct routing after
  deployment.
