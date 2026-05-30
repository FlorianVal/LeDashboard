import type { TimeRangePreset } from "../../hooks/useTimeRange";
import styles from "./TimeRangeSelector.module.css";

type Props = {
  presets: { preset: TimeRangePreset; label: string; selected: boolean }[];
  onSelect: (preset: TimeRangePreset) => void;
};

export default function TimeRangeSelector({ presets, onSelect }: Props) {
  return (
    <div className={styles.row}>
      {presets.map((p) => (
        <button
          key={p.preset}
          className={`${styles.pill} ${p.selected ? styles.active : ""}`}
          onClick={() => onSelect(p.preset)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
