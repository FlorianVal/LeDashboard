import { useState, useEffect, useRef, useCallback } from "react";
import type { MetricDef, MetricResponse } from "@ledashboard/shared";
import type { TimeRange } from "./useTimeRange";
import { fetchMetricDefinitions, fetchMetricData } from "../lib/api";

type MetricsMap = Map<string, MetricResponse>;

export function useMetrics(category: string | null, timeRange: TimeRange) {
  const [metricDefs, setMetricDefs] = useState<MetricDef[]>([]);
  const [metricsData, setMetricsData] = useState<MetricsMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDataRef = useRef(false);
  const genRef = useRef(0);
  const abortDataRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const c = new AbortController();
    fetchMetricDefinitions(c.signal)
      .then((defs) => {
        const filtered = category
          ? defs.filter((d) => d.category === category)
          : defs;
        setMetricDefs(filtered);
        if (filtered.length === 0) {
          setLoading(false);
        }
      })
      .catch((err) => {
        if (c.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Échec du chargement");
        setLoading(false);
      });
    return () => c.abort();
  }, [category]);

  const fetchData = useCallback(
    (signal: AbortSignal) => {
      const myGen = ++genRef.current;
      if (hasDataRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      return Promise.allSettled(
        metricDefs.map(async (def) => {
          const data = await fetchMetricData(
            def.id,
            timeRange.from,
            timeRange.to,
            timeRange.window,
            signal
          );
          return [def.id, data] as const;
        })
      )
        .then((results) => {
          if (genRef.current !== myGen) return;
          const map = new Map<string, MetricResponse>();
          for (const r of results) {
            if (r.status === "fulfilled") {
              map.set(r.value[0], r.value[1]);
            }
          }
          setMetricsData(map);
          setError(null);
          hasDataRef.current = true;
        })
        .catch((err) => {
          if (signal.aborted || genRef.current !== myGen) return;
          setError(err instanceof Error ? err.message : "Échec du chargement");
        })
        .finally(() => {
          if (genRef.current === myGen) {
            setLoading(false);
            setRefreshing(false);
          }
        });
    },
    [metricDefs, timeRange]
  );

  useEffect(() => {
    if (metricDefs.length === 0) return;
    const c = new AbortController();
    abortDataRef.current?.abort();
    abortDataRef.current = c;
    fetchData(c.signal);
    return () => c.abort();
  }, [fetchData]);

  const retry = useCallback(() => {
    if (metricDefs.length === 0) return;
    const c = new AbortController();
    abortDataRef.current?.abort();
    abortDataRef.current = c;
    fetchData(c.signal);
  }, [fetchData, metricDefs]);

  return { metricsData, metricDefs, loading, refreshing, error, retry };
}
