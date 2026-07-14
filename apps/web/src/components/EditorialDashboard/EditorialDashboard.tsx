import type { DashboardResponse, SourceFreshness } from "@ledashboard/shared";
import HouseChart from "../HouseChart/HouseChart";
import styles from "./EditorialDashboard.module.css";

type Props = {
  data: DashboardResponse;
  error: string | null;
  refreshing: boolean;
  onRetry: () => void;
};

const SOURCE_CONTEXT: Record<string, string> = {
  "home-assistant": "Maison",
  laplante: "Plantes",
  letimelapse: "Timelapse",
  mac: "Mac mini",
  nas: "NAS",
  availability: "Disponibilité",
};

const CHART_SOURCE = {
  comfort: "home-assistant",
  plants: "laplante",
  timelapseStorage: "letimelapse",
  macResources: "mac",
  macNetwork: "mac",
  nasStorage: "nas",
  availability: "availability",
} as const;

function freshnessLabel(sourceId: string, source?: SourceFreshness): string | undefined {
  if (!source || source.state === "fresh") return undefined;
  const context = SOURCE_CONTEXT[sourceId] ?? sourceId;
  return source.state === "stale"
    ? `${context} · données anciennes`
    : `${context} · source indisponible`;
}

function formatFact(value: number, unit: string, maximumFractionDigits = 1): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(value)} ${unit}`;
}

function weatherLabel(condition?: string): string {
  const labels: Record<string, string> = {
    sunny: "Ensoleillé",
    clear: "Ciel clair",
    partlycloudy: "Éclaircies",
    cloudy: "Nuageux",
    rainy: "Pluvieux",
    pouring: "Forte pluie",
    windy: "Venteux",
    fog: "Brumeux",
  };
  return condition ? labels[condition.toLowerCase()] ?? condition : "Conditions indisponibles";
}

function statusCopy(state: DashboardResponse["overallState"]) {
  if (state === "healthy") return { label: "Maison à jour", detail: "Les sources répondent normalement." };
  if (state === "degraded") return { label: "Maison à surveiller", detail: "Certaines mesures méritent votre attention." };
  return { label: "Maison à surveiller", detail: "Un incident demande votre attention." };
}

function generatedLabel(generatedAt: string): string {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return "Mise à jour récente";
  return `Mis à jour à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

export default function EditorialDashboard({ data, error, refreshing, onRetry }: Props) {
  const status = statusCopy(data.overallState);
  const weather = data.supportingFacts.weather;
  const allEmpty = Object.values(data.charts).every((chart) =>
    chart.series.every((item) => item.samples.length === 0),
  );
  const sourceStatus = (chartId: keyof typeof CHART_SOURCE) => {
    const sourceId = CHART_SOURCE[chartId];
    return freshnessLabel(sourceId, data.sources[sourceId]);
  };

  return (
    <div className={styles.panorama}>
      <header className={styles.masthead}>
        <div>
          <p className={styles.kicker}>Lumière naturelle</p>
          <h1>La maison, en un regard</h1>
          <p className={styles.intro}>Confort quotidien et infrastructure, réunis dans un panorama calme.</p>
        </div>
        <div className={`${styles.overall} ${styles[data.overallState]}`}>
          <span className={styles.stateDot} aria-hidden="true" />
          <div>
            <strong>{status.label}</strong>
            <span>{refreshing ? "Actualisation…" : generatedLabel(data.generatedAt)}</span>
          </div>
        </div>
      </header>

      {error && (
        <div className={styles.notice} role="alert">
          <div>
            <strong>Dernière vue conservée · {error}</strong>
            <span>Les valeurs visibles restent celles de la dernière mise à jour réussie.</span>
          </div>
          <button type="button" onClick={onRetry} disabled={refreshing}>Réessayer</button>
        </div>
      )}

      {data.activeIncidents.length > 0 && (
        <div className={`${styles.notice} ${styles.incident}`} role="alert">
          <div>
            <strong>
              {data.activeIncidents.length === 1
                ? `Incident en cours · ${data.activeIncidents[0].serviceId}`
                : `${data.activeIncidents.length} incidents en cours`}
            </strong>
            <span>{status.detail}</span>
          </div>
        </div>
      )}

      {allEmpty && (
        <section className={styles.emptyNotice} aria-labelledby="empty-title">
          <p className={styles.sectionLabel}>Panorama en attente</p>
          <h2 id="empty-title">Aucune mesure disponible</h2>
          <p>Les sept vues sont prêtes et se rempliront à la prochaine collecte.</p>
        </section>
      )}

      <section className={styles.hero} aria-label="Confort et météo actuelle">
        <HouseChart chart={data.charts.comfort} prominence="hero" sourceStatus={sourceStatus("comfort")} />
        <aside className={styles.weather} tabIndex={0}>
          <div className={styles.weatherTop}>
            <div>
              <p className={styles.sectionLabel}>Dehors maintenant</p>
              <h2>{weatherLabel(weather.condition?.value)}</h2>
            </div>
            {freshnessLabel("home-assistant", data.sources["home-assistant"]) && (
              <span className={styles.freshness}>{freshnessLabel("home-assistant", data.sources["home-assistant"])}</span>
            )}
          </div>
          <dl className={styles.weatherFacts}>
            <div>
              <dt>Humidité</dt>
              <dd>{weather.humidity ? formatFact(weather.humidity.value, weather.humidity.unit, 0) : "—"}</dd>
            </div>
            <div>
              <dt>Pression</dt>
              <dd>{weather.pressure ? formatFact(weather.pressure.value, weather.pressure.unit, 0) : "—"}</dd>
            </div>
            <div>
              <dt>Vent</dt>
              <dd>{weather.windSpeed ? formatFact(weather.windSpeed.value, weather.windSpeed.unit) : "—"}</dd>
            </div>
          </dl>
          <p className={styles.weatherNote}>Une lecture sobre des conditions qui accompagnent le confort intérieur.</p>
        </aside>
      </section>

      <section aria-labelledby="daily-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionLabel}>Rythmes du foyer</p>
            <h2 id="daily-title">Le quotidien</h2>
          </div>
          <p>Des repères simples, suivis sur leur propre temporalité.</p>
        </div>
        <div className={styles.household}>
          <HouseChart chart={data.charts.plants} sourceStatus={sourceStatus("plants")} />
          <HouseChart chart={data.charts.timelapseStorage} sourceStatus={sourceStatus("timelapseStorage")} />
        </div>
      </section>

      <section aria-labelledby="infra-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionLabel}>En arrière-plan</p>
            <h2 id="infra-title">Infrastructure</h2>
          </div>
          <p>Les ressources essentielles qui gardent la maison disponible.</p>
        </div>
        <div className={styles.infrastructure}>
          <HouseChart chart={data.charts.macResources} sourceStatus={sourceStatus("macResources")} />
          <HouseChart chart={data.charts.macNetwork} sourceStatus={sourceStatus("macNetwork")} />
          <HouseChart chart={data.charts.nasStorage} sourceStatus={sourceStatus("nasStorage")} />
          <HouseChart chart={data.charts.availability} sourceStatus={sourceStatus("availability")} />
        </div>
      </section>
    </div>
  );
}
