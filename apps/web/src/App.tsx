import EditorialDashboard from "./components/EditorialDashboard/EditorialDashboard";
import { useDashboard } from "./hooks/useDashboard";
import styles from "./App.module.css";

export default function App() {
  const { data, error, refreshing, retry } = useDashboard();

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        {!data && !error ? (
          <div className={styles.loading} role="status">
            <span aria-hidden="true" />
            <p>Préparation du panorama…</p>
          </div>
        ) : !data ? (
          <section className={styles.failure} aria-labelledby="failure-title">
            <p className={styles.kicker}>La maison reste silencieuse</p>
            <h1 id="failure-title">Le panorama ne répond pas</h1>
            <p>{error}</p>
            <button type="button" onClick={() => void retry()} disabled={refreshing}>Réessayer</button>
          </section>
        ) : (
          <EditorialDashboard
            data={data}
            error={error}
            refreshing={refreshing}
            onRetry={() => void retry()}
          />
        )}
      </main>
    </div>
  );
}
