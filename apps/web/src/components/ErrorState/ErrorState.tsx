import { AlertTriangle } from "lucide-react";
import styles from "./ErrorState.module.css";

type Props = {
  message?: string;
  onRetry?: () => void;
};

export default function ErrorState({
  message = "Impossible de charger les donnees",
  onRetry,
}: Props) {
  return (
    <div className={styles.wrapper}>
      <AlertTriangle size={48} className={styles.icon} />
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button className={styles.retryButton} onClick={onRetry}>
          Reessayer
        </button>
      )}
    </div>
  );
}
