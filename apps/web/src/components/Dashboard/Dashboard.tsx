import { useState, useEffect } from "react";
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
};

export default function Dashboard({ metricsData, timeRange }: Props) {
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [metricDefs, setMetricDefs] = useState<MetricDef[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {});
    fetchMetricDefinitions().then(setMetricDefs).catch(() => {});
  }, []);

  const filteredDefs = selectedCategory
    ? metricDefs.filter((d) => d.category === selectedCategory)
    : metricDefs;

  const visibleMetrics = filteredDefs.filter((d) => metricsData.has(d.id));

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
        {visibleMetrics.map((def) => {
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
            />
          );
        })}
      </div>
    </div>
  );
}
