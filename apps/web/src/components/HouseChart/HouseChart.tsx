import { useEffect, useMemo, useState } from "react";
import type { DashboardChart, DashboardSeries } from "@ledashboard/shared";
import { formatTimestamp, formatTimestampDate } from "@ledashboard/shared";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./HouseChart.module.css";

const SERIES_COLORS = ["#246d4e", "#8a6f3d", "#52798c", "#a35f4b"];

type Props = {
  chart: DashboardChart;
  sourceStatus?: string;
  prominence?: "hero" | "standard";
};

type ChartRow = { ts: number } & Record<string, number | undefined>;

function seriesId(item: DashboardSeries): string {
  return `${item.key}:${item.kind}`;
}

function mergeSeries(chart: DashboardChart): ChartRow[] {
  const rows = new Map<number, ChartRow>();
  for (const item of chart.series) {
    for (const sample of item.samples) {
      const row = rows.get(sample.ts) ?? { ts: sample.ts };
      row[seriesId(item)] = sample.avg;
      rows.set(sample.ts, row);
    }
  }
  const merged = Array.from(rows.values()).sort((left, right) => left.ts - right.ts);
  for (const item of chart.series) {
    if (item.kind !== "projection") continue;
    const id = seriesId(item);
    for (let index = 1; index < item.samples.length; index += 1) {
      const start = item.samples[index - 1];
      const end = item.samples[index];
      const duration = end.ts - start.ts;
      if (duration <= 0) continue;
      for (const row of merged) {
        if (row.ts <= start.ts || row.ts >= end.ts) continue;
        const progress = (row.ts - start.ts) / duration;
        row[id] = start.avg + (end.avg - start.avg) * progress;
      }
    }
  }
  return merged;
}

function byteValue(value: number, suffix = false): string {
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let scaled = value;
  let unitIndex = 0;
  while (Math.abs(scaled) >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(scaled)}${suffix ? ` ${units[unitIndex]}/s` : ` ${units[unitIndex]}`}`;
}

function formatMeasure(value: number, unit: string): string {
  if (unit === "bytes") return byteValue(value);
  if (unit === "B/s" || unit === "bytes/s") return byteValue(value, true);
  if (unit === "plants") {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} en retard`;
  }
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value)} ${unit}`.trim();
}

function axisMeasure(value: number, unit: string): string {
  if (unit === "bytes") return byteValue(value).replace(/\s/g, " ");
  if (unit === "B/s" || unit === "bytes/s") return byteValue(value, true).replace(/\s/g, " ");
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTime}>{formatTimestamp(label, "dd MMM · HH:mm")}</p>
      {payload.map((entry: any) => (
        <p className={styles.tooltipRow} key={entry.dataKey}>
          <span className={styles.tooltipDot} style={{ backgroundColor: entry.color }} />
          <span>{entry.name}</span>
          <strong>{formatMeasure(entry.value, entry.payload?.[`${entry.dataKey}:unit`] ?? entry.unit ?? "")}</strong>
        </p>
      ))}
    </div>
  );
}

export default function HouseChart({ chart, sourceStatus, prominence = "standard" }: Props) {
  const reducedMotion = useReducedMotion();
  const chartData = useMemo(() => {
    const rows = mergeSeries(chart);
    for (const row of rows) {
      for (const item of chart.series) row[`${seriesId(item)}:unit`] = item.unit as never;
    }
    return rows;
  }, [chart]);
  const hasData = chart.series.some((item) => item.samples.length > 0);
  const primaryUnit = chart.series[0]?.unit ?? "";
  const latestSummary = chart.series.map((item) => {
    const latest = item.samples[item.samples.length - 1];
    return `${item.name}${item.kind === "projection" ? " (projection)" : ""}: ${latest ? formatMeasure(latest.avg, item.unit) : "sans mesure"}`;
  }).join(". ");
  const summaryId = `chart-summary-${chart.id}`;

  return (
    <article
      className={`${styles.card} ${prominence === "hero" ? styles.hero : ""}`}
      tabIndex={0}
      aria-describedby={summaryId}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{chart.windowSeconds >= 86_400 * 30 ? "Tendance longue" : "Dernières mesures"}</p>
          <h2>{chart.title}</h2>
        </div>
        {sourceStatus && <span className={styles.sourceStatus}>{sourceStatus}</span>}
      </header>
      <p className={styles.srOnly} id={summaryId}>Graphique {chart.title}. {latestSummary}</p>
      {hasData ? (
        <div className={styles.plot} aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--house-border)" strokeDasharray="2 7" vertical={false} />
              <XAxis
                dataKey="ts"
                axisLine={false}
                tickLine={false}
                minTickGap={42}
                tick={{ fill: "var(--house-muted)", fontSize: 11 }}
                tickFormatter={(ts: number) => chart.windowSeconds <= 86_400
                  ? formatTimestamp(ts, "HH:mm")
                  : formatTimestampDate(ts)}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={52}
                tick={{ fill: "var(--house-muted)", fontSize: 11 }}
                tickFormatter={(value: number) => axisMeasure(value, primaryUnit)}
              />
              <Tooltip content={<ChartTooltip />} />
              {chart.series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
              {chart.series.map((item, index) => (
                <Line
                  key={seriesId(item)}
                  type="monotone"
                  dataKey={seriesId(item)}
                  name={item.name}
                  unit={item.unit}
                  stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                  strokeWidth={item.kind === "projection" ? 1.75 : 2.25}
                  strokeDasharray={item.kind === "projection" ? "6 6" : undefined}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, fill: "var(--house-surface)" }}
                  connectNulls={false}
                  isAnimationActive={!reducedMotion}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className={styles.empty}>Pas encore de courbe pour cette période.</div>
      )}
    </article>
  );
}
