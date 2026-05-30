import type { MetricDef } from "@ledashboard/shared";
import styles from "./CategoryNav.module.css";

type Props = {
  categories: { name: string; metricIds: string[] }[];
  metricDefs: MetricDef[];
  selected: string | null;
  onSelect: (category: string | null) => void;
};

export default function CategoryNav({
  categories,
  selected,
  onSelect,
}: Props) {
  return (
    <nav className={styles.nav}>
      <button
        className={`${styles.item} ${selected === null ? styles.active : ""}`}
        onClick={() => onSelect(null)}
      >
        Tout
      </button>
      {categories.map((cat) => (
        <button
          key={cat.name}
          className={`${styles.item} ${selected === cat.name ? styles.active : ""}`}
          onClick={() => onSelect(cat.name)}
        >
          <span className={styles.label}>{cat.name}</span>
          <span className={styles.count}>{cat.metricIds.length}</span>
        </button>
      ))}
    </nav>
  );
}
