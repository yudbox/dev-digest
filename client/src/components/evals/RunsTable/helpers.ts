/** Pure helpers for RunsTable — no React, no fetch. */
import type { EvalRunRecord } from "@devdigest/shared";

export interface EvalBatchRow {
  batch_id: string;
  ran_at: string;
  agent_version: number | null;
  /** Total cases (traces) run in this batch. */
  cases_total: number;
  traces_passed: number;
  recall: number;
  precision: number;
  citation_accuracy: number;
  cost_usd: number | null;
  /** For single-case batches: the case name (truncated). Null for multi-case batches. */
  case_name?: string | null;
}

/**
 * `dashboard.recent_runs` is a flat per-case list (`EvalRunRecord[]`); the
 * detail page's run-history table is per-BATCH ("Run all evals" invocation
 * or a single-case run, which is its own 1-case batch). Groups by
 * `batch_id`, macro-averaging metrics within each group (matching the
 * server's own batch-aggregation rule — mean of per-case metrics, not
 * re-summed tp/fp/fn). Legacy rows with a `null` batch_id (pre-migration)
 * are each treated as their own singleton batch rather than silently
 * dropped.
 */
export function groupRunsByBatch(runs: EvalRunRecord[]): EvalBatchRow[] {
  const order: string[] = [];
  const groups = new Map<string, EvalRunRecord[]>();

  for (const run of runs) {
    const key = run.batch_id ?? `legacy:${run.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(run);
  }

  return order.map((key) => {
    const rows = groups.get(key)!;
    const n = rows.length;
    const sum = (f: (r: EvalRunRecord) => number | null) =>
      rows.reduce((acc, r) => acc + (f(r) ?? 0), 0);
    const costs = rows
      .map((r) => r.cost_usd)
      .filter((c): c is number => c != null);
    return {
      batch_id: key,
      ran_at: rows[0]!.ran_at,
      agent_version: rows[0]!.agent_version,
      cases_total: n,
      traces_passed: rows.filter((r) => r.pass === true).length,
      recall: sum((r) => r.recall) / n,
      precision: sum((r) => r.precision) / n,
      citation_accuracy: sum((r) => r.citation_accuracy) / n,
      cost_usd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
      case_name:
        n === 1
          ? (rows[0]!.case_name?.replace(/^From finding:\s*/i, "").trim() ??
            null)
          : null,
    };
  });
}
