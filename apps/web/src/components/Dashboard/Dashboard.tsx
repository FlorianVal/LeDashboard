import { useState, useEffect, useMemo } from "react";
import type { CategoryInfo, MetricDef, MetricResponse } from "@ledashboard/shared";
import type { TimeRange } from "../../hooks/useTimeRange";
import { fetchCategories, fetchMetricDefinitions } from "../../lib/api";
import CategoryNav from "../CategoryNav/CategoryNav";
import MetricChartCard from "../MetricChartCard/MetricChartCard";
import EmptyState from "../EmptyState/EmptyState";
import styles from "./Dashboard.module.css";

type Props = {
  metricsData: Map<string, MetricResponse>;
  timeRange: TimeRange;
  refreshing: boolean;
  sourceNames: Record<string, string>;
};

export default function Dashboard({
  metricsData,
  timeRange,
  refreshing,
  sourceNames,
}: Props) {
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [metricDefs, setMetricDefs] = useState<MetricDef[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>("environment");

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {});
    fetchMetricDefinitions().then(setMetricDefs).catch(() => {});
  }, []);

  const filteredDefs = selectedCategory
    ? metricDefs.filter((d) => d.category === selectedCategory)
    : metricDefs;

  const visibleMetrics = filteredDefs.filter((d) => metricsData.has(d.id));

  const { groupedCards, ungroupedDefs } = useMemo(() => {
    const groupMap = new Map<string, { primary: MetricDef; overlays: MetricDef[] }>();
    const singletons: MetricDef[] = [];

    for (const def of visibleMetrics) {
      const group = def.labels?.group;
      if (group) {
        const key = `${def.sourceId}:${group}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, { primary: def, overlays: [] });
        } else {
          groupMap.get(key)!.overlays.push(def);
        }
      } else {
        singletons.push(def);
      }
    }

    return {
      groupedCards: Array.from(groupMap.values()),
      ungroupedDefs: singletons,
    };
  }, [visibleMetrics]);

  if (visibleMetrics.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className={styles.layout}>
      <CategoryNav
        categories={categories}
        metricDefs={metricDefs}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
      />
      <div className={styles.grid}>
        {groupedCards.map(({ primary, overlays }) => {
          const data = metricsData.get(primary.id);
          if (!data) return null;
          const overlayIds = overlays
            .map((o) => o.id)
            .filter((id) => metricsData.has(id));
          return (
            <MetricChartCard
              key={primary.id}
              primaryMetric={primary}
              primaryData={data}
              allMetrics={filteredDefs}
              allData={metricsData}
              timeRange={timeRange}
              initialOverlayIds={overlayIds}
              refreshing={refreshing}
              sourceName={sourceNames[primary.sourceId]}
            />
          );
        })}
        {ungroupedDefs.map((def) => {
          const data = metricsData.get(def.id);
          if (!data) return null;
          return (
            <MetricChartCard
              key={def.id}
              primaryMetric={def}
              primaryData={data}
              allMetrics={filteredDefs}
              allData={metricsData}
              timeRange={timeRange}
              refreshing={refreshing}
              sourceName={sourceNames[def.sourceId]}
            />
          );
        })}
      </div>
    </div>
  );
}
