import { useState, useMemo } from "react";
import { Plus, X } from "lucide-react";
import type { MetricDef, MetricResponse } from "@ledashboard/shared";
import type { TimeRange } from "../../hooks/useTimeRange";
import { scaleSeriesData, formatValue } from "../../lib/format";
import MetricChart from "../MetricChart/MetricChart";
import styles from "./MetricChartCard.module.css";

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
];

type Props = {
  primaryMetric: MetricDef;
  primaryData: MetricResponse;
  allMetrics: MetricDef[];
  allData: Map<string, MetricResponse>;
  timeRange: TimeRange;
  initialOverlayIds?: string[];
  refreshing?: boolean;
};

export default function MetricChartCard({
  primaryMetric,
  primaryData,
  allMetrics,
  allData,
  timeRange,
  initialOverlayIds,
  refreshing,
}: Props) {
  const [overlayIds, setOverlayIds] = useState<string[]>(initialOverlayIds ?? []);
  const [showPicker, setShowPicker] = useState(false);

  const sameCategoryMetrics = useMemo(
    () =>
      allMetrics.filter(
        (m) =>
          m.category === primaryMetric.category && m.id !== primaryMetric.id
      ),
    [allMetrics, primaryMetric]
  );

  const series = useMemo(() => {
    const unscaled = [
      {
        id: primaryMetric.id,
        name: primaryMetric.displayName || primaryMetric.name,
        color: CHART_COLORS[0],
        unit: primaryMetric.unit,
        data: primaryData.samples,
      },
    ];

    overlayIds.forEach((id, i) => {
      const data = allData.get(id);
      const def = allMetrics.find((m) => m.id === id);
      if (data && def) {
        unscaled.push({
          id: def.id,
          name: def.displayName || def.name,
          color: CHART_COLORS[(i + 1) % CHART_COLORS.length],
          unit: def.unit,
          data: data.samples,
        });
      }
    });

    return unscaled.map((s) => {
      const scaled = scaleSeriesData(s.data, s.unit);
      return { ...s, data: scaled.data, unit: scaled.displayUnit };
    });
  }, [primaryMetric, primaryData, overlayIds, allData, allMetrics]);

  const scaledPrimary = series[0];
  const latestValue = scaledPrimary?.data[scaledPrimary.data.length - 1]?.avg;

  const addOverlay = (id: string) => {
    if (!overlayIds.includes(id)) {
      setOverlayIds([...overlayIds, id]);
    }
    setShowPicker(false);
  };

  const removeOverlay = (id: string) => {
    setOverlayIds(overlayIds.filter((oid) => oid !== id));
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <h3 className={styles.title}>
            {primaryMetric.displayName || primaryMetric.name}
          </h3>
          <span className={styles.unit}>
            {latestValue !== undefined
              ? `${formatValue(latestValue, scaledPrimary.unit)}${scaledPrimary.unit ? ` ${scaledPrimary.unit}` : ""}`
              : "-"}
          </span>
        </div>
        <div className={styles.headerActions}>
          {overlayIds.map((id) => {
            const def = allMetrics.find((m) => m.id === id);
            return (
              <span key={id} className={styles.overlayChip}>
                {def?.displayName || id}
                <button
                  className={styles.chipRemove}
                  onClick={() => removeOverlay(id)}
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {sameCategoryMetrics.length > 0 && (
            <div className={styles.pickerWrapper}>
              <button
                className={styles.addButton}
                onClick={() => setShowPicker(!showPicker)}
              >
                <Plus size={14} />
              </button>
              {showPicker && (
                <div className={styles.picker}>
                  {sameCategoryMetrics
                    .filter((m) => !overlayIds.includes(m.id))
                    .map((m) => (
                      <button
                        key={m.id}
                        className={styles.pickerItem}
                        onClick={() => addOverlay(m.id)}
                      >
                        {m.displayName || m.name}
                      </button>
                    ))}
                  {sameCategoryMetrics.every((m) =>
                    overlayIds.includes(m.id)
                  ) && (
                    <span className={styles.pickerEmpty}>
                      Toutes les metriques sont affichees
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className={refreshing ? `${styles.body} ${styles.bodyRefreshing}` : styles.body}>
        <MetricChart series={series} timeRange={timeRange} />
        {refreshing && (
          <div className={styles.refreshingOverlay} aria-hidden="true">
            <span className={styles.spinner} />
          </div>
        )}
      </div>
    </div>
  );
}
