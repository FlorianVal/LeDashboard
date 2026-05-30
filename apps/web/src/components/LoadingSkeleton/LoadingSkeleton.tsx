import styles from "./LoadingSkeleton.module.css";

export default function LoadingSkeleton() {
  return (
    <div className={styles.wrapper}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={styles.card}>
          <div className={styles.header} />
          <div className={styles.chart} />
        </div>
      ))}
    </div>
  );
}
