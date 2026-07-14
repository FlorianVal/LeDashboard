// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ChartId,
  DashboardChart,
  DashboardResponse,
  DashboardSeries,
  MetricKey,
} from "@ledashboard/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import HouseChart from "../components/HouseChart/HouseChart";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => ({
    width: 800,
    height: 280,
    top: 0,
    right: 800,
    bottom: 280,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  }),
});
vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
})));

const NOW = 1_784_030_400;
const SAMPLE = { ts: NOW, avg: 21.4, min: 21.1, max: 21.8 };

function series(
  key: MetricKey,
  name: string,
  unit: string,
  kind: DashboardSeries["kind"] = "observed",
): DashboardSeries {
  return { key, kind, name, unit, samples: [SAMPLE] };
}

function chart(
  id: ChartId,
  title: string,
  chartSeries: DashboardSeries[],
): DashboardChart {
  return { id, title, windowSeconds: 86_400, series: chartSeries };
}

function dashboardFixture(): DashboardResponse {
  return {
    generatedAt: "2026-07-14T12:00:00.000Z",
    overallState: "degraded",
    charts: {
      comfort: chart("comfort", "Confort", [
        series("comfort.indoor_temperature", "Intérieur", "°C"),
        series("comfort.outdoor_temperature", "Extérieur", "°C"),
        series("comfort.climate_target", "Consigne", "°C"),
      ]),
      plants: chart("plants", "Plantes en retard", [
        series("plants.overdue_count", "En retard", "plants"),
      ]),
      timelapseStorage: chart("timelapseStorage", "Bibliothèque timelapse", [
        series("timelapse.library_bytes", "Bibliothèque", "bytes"),
      ]),
      macResources: chart("macResources", "Ressources du Mac mini", [
        series("mac.cpu_percent", "Processeur", "%"),
        series("mac.memory_percent", "Mémoire", "%"),
        series("mac.disk_percent", "Disque", "%"),
      ]),
      macNetwork: chart("macNetwork", "Réseau du Mac mini", [
        series("mac.network_receive_bps", "Réception", "B/s"),
        series("mac.network_transmit_bps", "Envoi", "B/s"),
      ]),
      nasStorage: chart("nasStorage", "Stockage du NAS", [
        series("nas.storage_used_bytes", "Utilisé", "bytes"),
        series("nas.storage_total_bytes", "Capacité", "bytes"),
        series("nas.storage_used_bytes", "Projection à 30 jours", "bytes", "projection"),
      ]),
      availability: chart("availability", "Disponibilité", [
        series("services.available_percent", "Services disponibles", "%"),
      ]),
    },
    facts: {
      "plants.last_watered_on": {
        key: "plants.last_watered_on",
        ts: NOW,
        numericValue: null,
        textValue: "2026-07-13",
      },
      "timelapse.capture_last_success_at": {
        key: "timelapse.capture_last_success_at",
        ts: NOW,
        numericValue: null,
        textValue: "2026-07-14T11:59:30.000Z",
      },
    },
    supportingFacts: {
      weather: {
        condition: { ts: NOW, value: "partlycloudy" },
        humidity: { ts: NOW, value: 53, unit: "%" },
        pressure: { ts: NOW, value: 1015, unit: "hPa" },
        windSpeed: { ts: NOW, value: 7.5, unit: "km/h" },
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
    activeIncidents: [],
  };
}

function response(body: DashboardResponse) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("Editorial dashboard", () => {
  it("draws the API-shaped NAS projection through intervening observed timestamps without joining observed gaps", () => {
    const nasChart = chart("nasStorage", "Stockage du NAS", [
      {
        ...series("nas.storage_used_bytes", "Utilisé", "bytes"),
        samples: [
          { ts: NOW, avg: 100, min: 100, max: 100 },
          { ts: NOW + 20, avg: 120, min: 120, max: 120 },
          { ts: NOW + 30, avg: 130, min: 130, max: 130 },
        ],
      },
      {
        ...series("nas.storage_total_bytes", "Capacité", "bytes"),
        samples: [
          { ts: NOW, avg: 1_000, min: 1_000, max: 1_000 },
          { ts: NOW + 10, avg: 1_000, min: 1_000, max: 1_000 },
          { ts: NOW + 20, avg: 1_000, min: 1_000, max: 1_000 },
          { ts: NOW + 30, avg: 1_000, min: 1_000, max: 1_000 },
        ],
      },
      {
        ...series(
          "nas.storage_used_bytes",
          "Projection à 30 jours",
          "bytes",
          "projection",
        ),
        samples: [
          { ts: NOW, avg: 100, min: 100, max: 100 },
          { ts: NOW + 40, avg: 140, min: 140, max: 140 },
        ],
      },
    ]);

    const { container } = render(<HouseChart chart={nasChart} />);
    const paths = Array.from(container.querySelectorAll<SVGPathElement>(".recharts-line-curve"));
    const projectionPath = paths.find((path) => path.getAttribute("stroke-dasharray") === "6 6");
    const observedUsedPath = paths.find((path) => path.getAttribute("stroke") === "#246d4e");

    expect(projectionPath?.getAttribute("d")).toMatch(/[LC]/);
    expect(observedUsedPath?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(screen.getByText(/Utilisé: 130 o/)).toBeInTheDocument();
    expect(screen.getByText(/Projection à 30 jours \(projection\): 140 o/)).toBeInTheDocument();
  });

  it("renders the seven curated chart titles, weather, and stale source context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(dashboardFixture())));

    render(<App />);

    expect(await screen.findByText("Confort")).toBeVisible();
    for (const title of [
      "Plantes en retard",
      "Bibliothèque timelapse",
      "Ressources du Mac mini",
      "Réseau du Mac mini",
      "Stockage du NAS",
      "Disponibilité",
    ]) {
      expect(screen.getByText(title)).toBeVisible();
    }
    expect(screen.getByText(/NAS · données anciennes/i)).toBeVisible();
    expect(screen.getByText("53 %")).toBeVisible();
    expect(screen.getByText("1 015 hPa")).toBeVisible();
    expect(screen.getByText("7,5 km\/h")).toBeVisible();
    expect(screen.getAllByText(/Projection à 30 jours/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Raspberry|PC|iPhone|média|vidéo/i)).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows loading, then an explicit empty panorama", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    render(<App />);
    expect(screen.getByText(/Préparation du panorama/i)).toBeVisible();

    const fixture = dashboardFixture();
    for (const dashboardChart of Object.values(fixture.charts)) {
      for (const dashboardSeries of dashboardChart.series) dashboardSeries.samples = [];
    }
    await act(async () => resolveFetch(response(fixture)));

    expect(await screen.findByText(/Aucune mesure disponible/i)).toBeVisible();
    expect(screen.getByText("Confort")).toBeVisible();
  });

  it("offers a retry after an initial request failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503, statusText: "Unavailable" }))
      .mockResolvedValueOnce(response(dashboardFixture()));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    expect(await screen.findByText(/Le panorama ne répond pas/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Réessayer/i }));

    expect(await screen.findByText("Confort")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps current data visible when a background refresh partially fails", async () => {
    let refreshFromInterval!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60_000) refreshFromInterval = handler as () => void;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(dashboardFixture()))
      .mockRejectedValueOnce(new Error("Connexion interrompue"));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(await screen.findByText("Confort")).toBeVisible();

    await act(async () => {
      refreshFromInterval();
      await Promise.resolve();
    });

    expect(screen.getByText("Confort")).toBeVisible();
    expect(await screen.findByText(/Dernière vue conservée · Connexion interrompue/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /Réessayer/i })).toBeVisible();
  });

  it("aborts a replaced request so an older response cannot overwrite newer dashboard state", async () => {
    let refreshFromInterval!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60_000) refreshFromInterval = handler as () => void;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const older = deferred<Response>();
    const newer = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    act(() => refreshFromInterval());
    const olderSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    const newerSignal = fetchMock.mock.calls[1][1]?.signal as AbortSignal;
    expect(olderSignal.aborted).toBe(true);
    expect(newerSignal.aborted).toBe(false);

    const newestFixture = dashboardFixture();
    newestFixture.charts.comfort.title = "Confort récent";
    await act(async () => newer.resolve(response(newestFixture)));
    expect(await screen.findByText("Confort récent")).toBeVisible();

    await act(async () => older.resolve(response(dashboardFixture())));
    expect(screen.getByText("Confort récent")).toBeVisible();
    expect(screen.queryByText(/^Confort$/)).toBeNull();
  });

  it("aborts an in-flight periodic refresh on unmount and ignores its deferred response", async () => {
    let refreshFromInterval!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60_000) refreshFromInterval = handler as () => void;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const periodic = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(dashboardFixture()))
      .mockReturnValueOnce(periodic.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<App />);
    expect(await screen.findByText("Confort")).toBeVisible();

    act(() => refreshFromInterval());
    const periodicSignal = fetchMock.mock.calls[1][1]?.signal as AbortSignal;
    view.unmount();
    expect(periodicSignal.aborted).toBe(true);

    await act(async () => periodic.resolve(response(dashboardFixture())));
    expect(screen.queryByText("Confort")).toBeNull();
  });

  it("announces active incidents with their service context", async () => {
    const fixture = dashboardFixture();
    fixture.overallState = "down";
    fixture.activeIncidents = [{
      id: 12,
      serviceId: "plex",
      startedAt: "2026-07-14T11:58:00.000Z",
      endedAt: null,
      lastError: "timeout",
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fixture)));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Incident en cours · plex/i);
    expect(screen.getByText(/Maison à surveiller/i)).toBeVisible();
  });
});
