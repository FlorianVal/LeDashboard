import type {
  ChartId,
  DashboardChart,
  DashboardResponse,
  DashboardSeries,
  MetricKey,
  Sample,
} from "@ledashboard/shared";

const START = 1_783_972_800;

function samples(values: readonly number[]): Sample[] {
  return values.map((value, index) => ({
    ts: START + index * 10_800,
    avg: value,
    min: value - Math.max(Math.abs(value) * 0.01, 0.1),
    max: value + Math.max(Math.abs(value) * 0.01, 0.1),
  }));
}

function series(
  key: MetricKey,
  name: string,
  unit: string,
  values: readonly number[],
  kind: DashboardSeries["kind"] = "observed",
): DashboardSeries {
  return { key, kind, name, unit, samples: samples(values) };
}

function chart(
  id: ChartId,
  title: string,
  chartSeries: DashboardSeries[],
  windowSeconds = 86_400,
): DashboardChart {
  return { id, title, windowSeconds, series: chartSeries };
}

export const dashboardFixture: DashboardResponse = {
  generatedAt: "2026-07-14T12:00:00.000Z",
  overallState: "degraded",
  charts: {
    comfort: chart("comfort", "Confort", [
      series("comfort.indoor_temperature", "Intérieur", "°C", [20.8, 21, 21.3, 21.7, 22, 21.8, 21.5, 21.4]),
      series("comfort.outdoor_temperature", "Extérieur", "°C", [16, 17.5, 19.8, 22.2, 24, 22.4, 19.3, 17.8]),
      series("comfort.climate_target", "Consigne", "°C", [21, 21, 21, 21, 21, 21, 21, 21]),
    ]),
    plants: chart("plants", "Plantes en retard", [
      series("plants.overdue_count", "En retard", "plants", [1, 1, 2, 2, 2, 1, 1, 1]),
    ]),
    timelapseStorage: chart("timelapseStorage", "Bibliothèque timelapse", [
      series("timelapse.library_bytes", "Bibliothèque", "bytes", [
        536_870_912_000, 537_944_653_824, 539_018_395_648, 540_092_137_472,
        541_165_879_296, 542_239_621_120, 543_313_362_944, 544_387_104_768,
      ]),
    ], 2_592_000),
    macResources: chart("macResources", "Ressources du Mac mini", [
      series("mac.cpu_percent", "Processeur", "%", [18, 24, 31, 22, 28, 20, 25, 23]),
      series("mac.memory_percent", "Mémoire", "%", [61, 62, 63, 64, 64, 65, 65, 66]),
      series("mac.disk_percent", "Disque", "%", [48, 48, 48.2, 48.2, 48.3, 48.4, 48.4, 48.5]),
    ]),
    macNetwork: chart("macNetwork", "Réseau du Mac mini", [
      series("mac.network_receive_bps", "Réception", "B/s", [120_000, 260_000, 180_000, 420_000, 230_000, 310_000, 190_000, 270_000]),
      series("mac.network_transmit_bps", "Envoi", "B/s", [80_000, 110_000, 95_000, 170_000, 120_000, 150_000, 105_000, 130_000]),
    ]),
    nasStorage: chart("nasStorage", "Stockage du NAS", [
      series("nas.storage_used_bytes", "Utilisé", "bytes", [
        7_696_581_394_432, 7_707_318_812_672, 7_718_056_230_912, 7_728_793_649_152,
        7_739_531_067_392, 7_750_268_485_632, 7_761_005_903_872, 7_771_743_322_112,
      ]),
      series("nas.storage_total_bytes", "Capacité", "bytes", Array(8).fill(13_194_139_533_312)),
      series("nas.storage_used_bytes", "Projection à 30 jours", "bytes", [7_771_743_322_112, 8_045_282_402_304], "projection"),
    ], 2_592_000),
    availability: chart("availability", "Disponibilité", [
      series("services.available_percent", "Services disponibles", "%", [100, 100, 92.3, 92.3, 100, 100, 92.3, 92.3]),
    ]),
  },
  facts: {
    "plants.last_watered_on": {
      key: "plants.last_watered_on",
      ts: START + 75_600,
      numericValue: null,
      textValue: "2026-07-13",
    },
    "timelapse.capture_last_success_at": {
      key: "timelapse.capture_last_success_at",
      ts: START + 75_600,
      numericValue: null,
      textValue: "2026-07-14T11:59:30.000Z",
    },
  },
  supportingFacts: {
    weather: {
      condition: { ts: START + 75_600, value: "partlycloudy" },
      humidity: { ts: START + 75_600, value: 53, unit: "%" },
      pressure: { ts: START + 75_600, value: 1015, unit: "hPa" },
      windSpeed: { ts: START + 75_600, value: 7.5, unit: "km/h" },
    },
  },
  sources: {
    "home-assistant": { state: "fresh", lastSuccessAt: "2026-07-14T12:00:00.000Z", lastError: null },
    laplante: { state: "fresh", lastSuccessAt: "2026-07-14T12:00:00.000Z", lastError: null },
    letimelapse: { state: "fresh", lastSuccessAt: "2026-07-14T12:00:00.000Z", lastError: null },
    mac: { state: "fresh", lastSuccessAt: "2026-07-14T12:00:00.000Z", lastError: null },
    nas: { state: "stale", lastSuccessAt: "2026-07-13T12:00:00.000Z", lastError: null },
    availability: { state: "fresh", lastSuccessAt: "2026-07-14T12:00:00.000Z", lastError: null },
  },
  activeIncidents: [{
    id: 17,
    serviceId: "couchdb",
    startedAt: "2026-07-14T11:58:00.000Z",
    endedAt: null,
    lastError: "request_failed",
  }],
};
