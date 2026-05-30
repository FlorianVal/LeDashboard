import type { DbContext } from "../db/client.js";
import { deleteSamplesOlderThan } from "../db/queries.js";
import { unixTimestamp } from "@ledashboard/shared";

export function pruneOldSamples(
  db: DbContext,
  retentionDays: number = 90
): number {
  const cutoff = unixTimestamp() - retentionDays * 86400;
  const deleted = deleteSamplesOlderThan(db, cutoff);
  if (deleted > 0) {
    console.log(`Pruned ${deleted} samples older than ${retentionDays} days`);
  }
  return deleted;
}
