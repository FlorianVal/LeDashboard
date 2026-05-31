import { useState, useEffect, useRef, useCallback } from "react";
import type { MetricDef, MetricResponse } from "@ledashboard/shared";
import type { TimeRange } from "./useTimeRange";
import { fetchMetricDefinitions, fetchMetricData } from "../lib/api";

const POLL_INTERVAL_MS = 60_000;

type MetricsMap = Map<string, MetricResponse>;

export function useMetrics(category: string | null, timeRange: TimeRange) {
  const [metricsData, setMetricsData] = useState<MetricsMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricDefs, setMetricDefs] = useState<MetricDef[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const isFirstFetch = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      const defs = await fetchMetricDefinitions();
      const filtered = category
        ? defs.filter((d) => d.category === category)
        : defs;
      setMetricDefs(filtered);

      const map = new Map<string, MetricResponse>();
      for (const def of filtered) {
        try {
          const data = await fetchMetricData(
            def.id,
            timeRange.from,
            timeRange.to,
            timeRange.window
          );
          map.set(def.id, data);
        } catch {
          // Keep going for other metrics
        }
      }
      setMetricsData(map);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du chargement");
    } finally {
      setLoading(false);
    }
  }, [category, timeRange]);

  useEffect(() => {
    if (isFirstFetch.current) {
      setLoading(true);
      isFirstFetch.current = false;
    }
    fetchAll();

    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  return { metricsData, metricDefs, loading, error, retry: fetchAll };
}
