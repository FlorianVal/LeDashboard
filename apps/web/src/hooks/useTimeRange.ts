import { useState, useMemo } from "react";
import { unixTimestamp, secondsAgo, computeWindow } from "@ledashboard/shared";

export type TimeRangePreset = "1h" | "6h" | "24h" | "7d" | "30d" | "90d";

export type TimeRange = {
  from: number;
  to: number;
  label: string;
  preset: TimeRangePreset;
  window: number;
};

const PRESETS: { preset: TimeRangePreset; label: string; seconds: number }[] = [
  { preset: "1h", label: "1H", seconds: 3600 },
  { preset: "6h", label: "6H", seconds: 21600 },
  { preset: "24h", label: "24H", seconds: 86400 },
  { preset: "7d", label: "7J", seconds: 604800 },
  { preset: "30d", label: "30J", seconds: 2592000 },
  { preset: "90d", label: "3M", seconds: 7776000 },
];

function buildRange(preset: TimeRangePreset): TimeRange {
  const entry = PRESETS.find((p) => p.preset === preset)!;
  const now = unixTimestamp();
  const from = secondsAgo(entry.seconds);
  return {
    from,
    to: now,
    label: entry.label,
    preset: entry.preset,
    window: computeWindow(entry.seconds),
  };
}

export function useTimeRange(defaultPreset: TimeRangePreset = "24h") {
  const [range, setRange] = useState<TimeRange>(() => buildRange(defaultPreset));

  const presets = useMemo(
    () =>
      PRESETS.map((p) => ({
        preset: p.preset,
        label: p.label,
        selected: p.preset === range.preset,
      })),
    [range.preset]
  );

  const setPreset = (preset: TimeRangePreset) => setRange(buildRange(preset));

  return { range, presets, setPreset };
}
