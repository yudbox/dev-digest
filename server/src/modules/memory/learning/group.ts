/**
 * Group dismissed findings into batches suitable for distillation.
 *
 * Grouping key: (repoId, category, directory(file))
 * AC-R14, clarification 2.
 */
import type { DismissedFindingRow } from "../repository.js";
import path from "node:path";

export interface DismissGroup {
  repoId: string;
  category: string;
  directory: string;
  dismisses: DismissedFindingRow[];
  /** Latest dismissedAt across the batch — used to advance the watermark. */
  maxDismissedAt: Date;
}

/**
 * Groups dismiss rows by (repoId, category, directory).
 * Returns all groups (caller decides which meet the threshold).
 */
export function groupDismisses(rows: DismissedFindingRow[]): DismissGroup[] {
  const map = new Map<string, DismissGroup>();

  for (const row of rows) {
    const dir = path.dirname(row.file);
    const key = `${row.repoId}||${row.category}||${dir}`;

    const existing = map.get(key);
    if (existing) {
      existing.dismisses.push(row);
      if (row.dismissedAt > existing.maxDismissedAt) {
        existing.maxDismissedAt = row.dismissedAt;
      }
    } else {
      map.set(key, {
        repoId: row.repoId,
        category: row.category,
        directory: dir,
        dismisses: [row],
        maxDismissedAt: row.dismissedAt,
      });
    }
  }

  return Array.from(map.values());
}
