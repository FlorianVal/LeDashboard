import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const metricDefinitions = sqliteTable("metric_definitions", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  category: text("category").notNull(),
  unit: text("unit"),
  labelsJson: text("labels_json"),
  createdAt: text("created_at").notNull(),
});

export const samples = sqliteTable(
  "samples",
  {
    id: text("id").primaryKey(),
    metricId: text("metric_id")
      .notNull()
      .references(() => metricDefinitions.id, { onDelete: "cascade" }),
    ts: integer("ts").notNull(),
    value: real("value").notNull(),
  },
  (table) => [
    index("samples_metric_ts_idx").on(table.metricId, table.ts),
    index("samples_ts_idx").on(table.ts),
  ]
);
