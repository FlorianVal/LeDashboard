import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardResponse } from "@ledashboard/shared";
import { fetchDashboard } from "../lib/api";

export function useDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activeController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setRefreshing(true);
    try {
      const nextData = await fetchDashboard(controller.signal);
      if (controller.signal.aborted) return;
      setData(nextData);
      setError(null);
    } catch (cause) {
      if (controller.signal.aborted
        || (cause instanceof DOMException && cause.name === "AbortError")) return;
      setError(cause instanceof Error ? cause.message : "Chargement impossible");
    } finally {
      if (activeController.current === controller && !controller.signal.aborted) {
        activeController.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(timer);
      activeController.current?.abort();
      activeController.current = null;
    };
  }, [refresh]);

  return { data, error, refreshing, retry: refresh };
}
