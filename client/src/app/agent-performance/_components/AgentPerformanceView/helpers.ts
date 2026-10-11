import type { AgentPerfRow } from "@devdigest/shared";
import { ARROW_MIN_PP, SMALL_SAMPLE_DECISIONS } from "@/components/stats/constants";

/** Columns the table can be sorted by. */
export type SortColumn = "runs" | "avgCost" | "avgDuration" | "accept" | "lastRun";
export type SortDir = "asc" | "desc";

export const DEFAULT_SORT: { column: SortColumn; dir: SortDir } = { column: "accept", dir: "desc" };

/** Accept rate as a percentage, or null when nothing has been decided. */
export function acceptPct(row: Pick<AgentPerfRow, "accept">): number | null {
  return row.accept.resolved > 0 ? (row.accept.accepted / row.accept.resolved) * 100 : null;
}

const timeOf = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null);

function sortValue(row: AgentPerfRow, column: SortColumn): number | null {
  switch (column) {
    case "runs":
      return row.runs;
    case "avgCost":
      return row.avgCostUsd;
    case "avgDuration":
      return row.avgDurationMs;
    case "accept":
      return acceptPct(row);
    case "lastRun":
      return timeOf(row.lastRunAt);
  }
}

/**
 * Sort the agent table (client-side; never a request). Rules:
 *  - rows with no value in the sorted column ("—") go after rows with values,
 *    in both directions;
 *  - sorting by Accept: agents with enough decisions first, then small samples
 *    (so one lucky 100% cannot top the list), then agents with no decisions —
 *    in both directions;
 *  - the aggregated "Deleted agents" row always stays last;
 *  - ties fall back to the agent name.
 */
export function sortAgentRows(rows: AgentPerfRow[], column: SortColumn, dir: SortDir): AgentPerfRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const tier = (r: AgentPerfRow): number => {
    if (r.id === null) return 9; // Deleted agents
    if (column !== "accept") return sortValue(r, column) === null ? 2 : 0;
    if (r.accept.resolved === 0) return 3;
    return r.accept.resolved < SMALL_SAMPLE_DECISIONS ? 1 : 0;
  };
  return [...rows].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    const va = sortValue(a, column);
    const vb = sortValue(b, column);
    if (va !== null && vb !== null && va !== vb) return (va - vb) * sign;
    return a.name.localeCompare(b.name);
  });
}

export type AcceptTrend =
  | { kind: "up"; was: { accepted: number; resolved: number } }
  | { kind: "down"; was: { accepted: number; resolved: number } }
  | { kind: "none"; reason: "flat" | "noCurrent" | "noHistory" | "fewDecisions"; was?: { accepted: number; resolved: number } };

/**
 * The accept-rate arrow versus the previous window. ↑/↓ only when both windows
 * have decisions, the previous one has enough of them, and the rate moved by at
 * least one percentage point. Otherwise the reason is returned so the UI can
 * explain the missing arrow instead of guessing.
 */
export function acceptTrend(row: Pick<AgentPerfRow, "accept" | "previousAccept">): AcceptTrend {
  const prev = row.previousAccept;
  if (prev === null) return { kind: "none", reason: "noHistory" };
  if (prev.resolved < SMALL_SAMPLE_DECISIONS) return { kind: "none", reason: "fewDecisions", was: prev };
  const now = acceptPct(row);
  if (now === null) return { kind: "none", reason: "noCurrent", was: prev };
  const before = (prev.accepted / prev.resolved) * 100;
  const delta = now - before;
  if (delta >= ARROW_MIN_PP) return { kind: "up", was: prev };
  if (delta <= -ARROW_MIN_PP) return { kind: "down", was: prev };
  return { kind: "none", reason: "flat", was: prev };
}

/** Palette for model segments (agents use their own colour). */
export const MODEL_PALETTE = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6", "#f97316"] as const;
export const DELETED_COLOR = "var(--text-muted)";
