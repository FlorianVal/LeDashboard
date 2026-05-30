import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { Sample } from "@ledashboard/shared";
import { formatTimestamp, formatTimestampDate } from "@ledashboard/shared";
import type { TimeRange } from "../../hooks/useTimeRange";
import styles from "./MetricChart.module.css";

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

type Series = {
  id: string;
  name: string;
  color: string;
  unit?: string | null;
  data: Sample[];
};

type Props = {
  series: Series[];
  timeRange: TimeRange;
};

function mergeSeriesData(series: Series[]) {
  const timeMap = new Map<number, Record<string, number>>();

  for (const s of series) {
    for (const point of s.data) {
      if (!timeMap.has(point.ts)) {
        timeMap.set(point.ts, {});
      }
      timeMap.get(point.ts)![s.id] = point.avg;
    }
  }

  return Array.from(timeMap.entries())
    .map(([ts, values]) => ({ ts, ...values }))
    .sort((a, b) => a.ts - b.ts);
}

function formatTick(ts: number, timeRange: TimeRange): string {
  if (timeRange.preset === "1h" || timeRange.preset === "6h") {
    return formatTimestamp(ts, "HH:mm");
  }
  return formatTimestampDate(ts);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTime}>
        {formatTimestamp(label, "dd MMM HH:mm")}
      </div>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className={styles.tooltipRow}>
          <span
            className={styles.tooltipDot}
            style={{ background: entry.color }}
          />
          <span className={styles.tooltipName}>{entry.name}:</span>
          <span className={styles.tooltipValue}>
            {entry.value?.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function MetricChart({ series, timeRange }: Props) {
  const chartData = mergeSeriesData(series);
  const hasMultipleY = series.some((s) => s.unit !== series[0].unit);
  const primaryUnit = series[0]?.unit;

  return (
    <div className={styles.container}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="ts"
            tickFormatter={(ts: number) => formatTick(ts, timeRange)}
            stroke="var(--color-text-muted)"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            yAxisId="left"
            stroke="var(--color-text-muted)"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={50}
            unit={primaryUnit ? ` ${primaryUnit}` : undefined}
          />
          {hasMultipleY && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="var(--color-text-muted)"
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          {series.length > 1 && <Legend />}
          {series.map((s, i) => (
            <Line
              key={s.id}
              yAxisId={
                hasMultipleY && s.unit !== primaryUnit ? "right" : "left"
              }
              type="monotone"
              dataKey={s.id}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
