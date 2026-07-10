/** Pure helpers for EvalsTab — no React, no fetch. */
import type { EvalRunRecord } from "@devdigest/shared";

/** Most recent run for a given case, or `null` if the case has never run.
 *  `recentRuns` is already most-recent-first (server contract). */
export function lastRunForCase(
  recentRuns: EvalRunRecord[] | undefined,
  caseId: string,
): EvalRunRecord | null {
  if (!recentRuns) return null;
  return recentRuns.find((r) => r.case_id === caseId) ?? null;
}

export interface MetricPair {
  recall?: number;
  precision?: number;
}

export interface WithWithoutMetrics {
  with: MetricPair | null;
  without: MetricPair | null;
}

/** Skill-case runs persist `{ with: {...}, without: {...} }` in the
 *  (otherwise-unstructured) `actual_output` jsonb column (Q6). Parsed
 *  defensively — absent/malformed shapes just yield `null` pairs. */
export function parseWithWithout(actualOutput: unknown): WithWithoutMetrics {
  if (actualOutput && typeof actualOutput === "object") {
    const o = actualOutput as Record<string, unknown>;
    return {
      with: readMetricPair(o.with),
      without: readMetricPair(o.without),
    };
  }
  return { with: null, without: null };
}

function readMetricPair(v: unknown): MetricPair | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      recall: typeof o.recall === "number" ? o.recall : undefined,
      precision: typeof o.precision === "number" ? o.precision : undefined,
    };
  }
  return null;
}
