import { BarChart3 } from "lucide-react";
import styles from "./EmptyState.module.css";

export default function EmptyState() {
  return (
    <div className={styles.wrapper}>
      <BarChart3 size={48} className={styles.icon} />
      <p className={styles.title}>Aucune metrique</p>
      <p className={styles.hint}>
        Creez un fichier sources.yaml pour commencer a collecter des donnees.
      </p>
    </div>
  );
}
