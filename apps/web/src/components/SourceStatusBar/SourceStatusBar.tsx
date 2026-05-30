import type { SourceStatus } from "@ledashboard/shared";
import { formatRelativeTime } from "@ledashboard/shared";
import styles from "./SourceStatusBar.module.css";

type Props = {
  statuses: SourceStatus[];
};

export default function SourceStatusBar({ statuses }: Props) {
  if (statuses.length === 0) return null;

  return (
    <div className={styles.bar}>
      {statuses.map((s) => {
        const isError = s.lastError !== null;
        const isActive = s.lastCollectedAt !== null && !isError;
        return (
          <div key={s.id} className={styles.source}>
            <span
              className={`${styles.dot} ${isActive ? styles.green : isError ? styles.red : styles.gray}`}
            />
            <span className={styles.name}>{s.name}</span>
            {s.lastCollectedAt && (
              <span className={styles.time}>
                {formatRelativeTime(s.lastCollectedAt)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
