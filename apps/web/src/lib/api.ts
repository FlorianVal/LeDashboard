import type {
  DashboardResponse,
  MetricDef,
  MetricResponse,
  CategoryInfo,
  SourceStatus,
} from "@ledashboard/shared";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/api`;

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function fetchDashboard(signal?: AbortSignal): Promise<DashboardResponse> {
  return fetchJson<DashboardResponse>(`${API_BASE}/dashboard`, signal);
}

export function fetchMetricDefinitions(signal?: AbortSignal): Promise<MetricDef[]> {
  return fetchJson<MetricDef[]>(`${API_BASE}/metrics`, signal);
}

export function fetchMetricData(
  id: string,
  from: number,
  to: number,
  window?: number,
  signal?: AbortSignal
): Promise<MetricResponse> {
  const params = new URLSearchParams({
    from: String(from),
    to: String(to),
  });
  if (window !== undefined && window > 0) {
    params.set("window", String(window));
  }
  return fetchJson<MetricResponse>(
    `${API_BASE}/metrics/${encodeURIComponent(id)}?${params}`,
    signal
  );
}

export function fetchCategories(): Promise<CategoryInfo[]> {
  return fetchJson<CategoryInfo[]>(`${API_BASE}/metrics/categories`);
}

export function fetchSourceStatuses(): Promise<SourceStatus[]> {
  return fetchJson<SourceStatus[]>(`${API_BASE}/sources`);
}
