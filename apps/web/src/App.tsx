import { useMetrics } from "./hooks/useMetrics";
import { useTimeRange } from "./hooks/useTimeRange";
import { useSourcesStatus } from "./hooks/useSourcesStatus";
import TimeRangeSelector from "./components/TimeRangeSelector/TimeRangeSelector";
import SourceStatusBar from "./components/SourceStatusBar/SourceStatusBar";
import Dashboard from "./components/Dashboard/Dashboard";
import LoadingSkeleton from "./components/LoadingSkeleton/LoadingSkeleton";
import ErrorState from "./components/ErrorState/ErrorState";
import styles from "./App.module.css";

export default function App() {
  const { range, presets, setPreset } = useTimeRange("24h");
  const { metricsData, loading, error, retry } = useMetrics(null, range);
  const statuses = useSourcesStatus();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <span className={styles.kicker}>Maison</span>
            <h1 className={styles.title}>Metriques</h1>
          </div>
          <TimeRangeSelector presets={presets} onSelect={setPreset} />
        </div>
        <SourceStatusBar statuses={statuses} />
      </header>

      <main className={styles.main}>
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={retry} />
        ) : (
          <Dashboard metricsData={metricsData} timeRange={range} />
        )}
      </main>
    </div>
  );
}
