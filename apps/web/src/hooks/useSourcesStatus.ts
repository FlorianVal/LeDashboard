import { useState, useEffect, useRef } from "react";
import type { SourceStatus } from "@ledashboard/shared";
import { fetchSourceStatuses } from "../lib/api";

export function useSourcesStatus() {
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await fetchSourceStatuses();
        setStatuses(data);
      } catch {
        // Silently ignore
      }
    };
    fetch();
    intervalRef.current = setInterval(fetch, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return statuses;
}
