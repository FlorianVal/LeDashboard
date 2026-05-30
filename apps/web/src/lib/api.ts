import type {
  MetricDef,
  MetricResponse,
  CategoryInfo,
  SourceStatus,
} from "@ledashboard/shared";

const API_BASE = "/api";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function fetchMetricDefinitions(): Promise<MetricDef[]> {
  return fetchJson<MetricDef[]>(`${API_BASE}/metrics`);
}

export function fetchMetricData(
  id: string,
  from: number,
  to: number,
  window?: number
): Promise<MetricResponse> {
  const params = new URLSearchParams({
    from: String(from),
    to: String(to),
  });
  if (window !== undefined && window > 0) {
    params.set("window", String(window));
  }
  return fetchJson<MetricResponse>(
    `${API_BASE}/metrics/${encodeURIComponent(id)}?${params}`
  );
}

export function fetchCategories(): Promise<CategoryInfo[]> {
  return fetchJson<CategoryInfo[]>(`${API_BASE}/metrics/categories`);
}

export function fetchSourceStatuses(): Promise<SourceStatus[]> {
  return fetchJson<SourceStatus[]>(`${API_BASE}/sources`);
}
