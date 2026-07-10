/** Pure helpers for CompareRunsModal — no React, no fetch. */
import type { EvalBatchRow } from "../RunsTable/helpers";

export interface OrderedBatches {
  older: EvalBatchRow;
  newer: EvalBatchRow;
}

/** Orders two selected batches chronologically (older/newer) so the diff and
 *  metric deltas always read old→new regardless of click order. */
export function orderByRanAt(a: EvalBatchRow, b: EvalBatchRow): OrderedBatches {
  return new Date(a.ran_at).getTime() <= new Date(b.ran_at).getTime()
    ? { older: a, newer: b }
    : { older: b, newer: a };
}

export interface MetricDelta {
  key: "recall" | "precision" | "citation_accuracy" | "cost_usd";
  older: number | null;
  newer: number | null;
  delta: number | null;
}

export function computeDeltas(
  older: EvalBatchRow,
  newer: EvalBatchRow,
): MetricDelta[] {
  return [
    {
      key: "recall",
      older: older.recall,
      newer: newer.recall,
      delta: newer.recall - older.recall,
    },
    {
      key: "precision",
      older: older.precision,
      newer: newer.precision,
      delta: newer.precision - older.precision,
    },
    {
      key: "citation_accuracy",
      older: older.citation_accuracy,
      newer: newer.citation_accuracy,
      delta: newer.citation_accuracy - older.citation_accuracy,
    },
    {
      key: "cost_usd",
      older: older.cost_usd,
      newer: newer.cost_usd,
      delta:
        older.cost_usd != null && newer.cost_usd != null
          ? newer.cost_usd - older.cost_usd
          : null,
    },
  ];
}
