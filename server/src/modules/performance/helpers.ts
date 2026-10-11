import {
  FINDING_CATEGORY_ORDER,
  type AcceptFraction,
  type AgentPerfRow,
  type CategoryCount,
  type CostSegment,
  type CostSourceBadge,
  type FindingRecord,
  type RecentRun,
  type SeverityBucket,
  type SkillStatsResponse,
  type StatsBucket,
  type StatsWindow,
} from "@devdigest/shared";
import type * as t from "../../db/schema.js";
import { MAX_SEGMENTS, MIN_PREV_COSTED_RUNS } from "./constants.js";

/**
 * Pure helpers of the performance module (no DB, no `this`): they turn the
 * repository's raw aggregates into the response shapes. The dashboard row and
 * the Agent Stats KPIs both go through `toAgentRow`, so they cannot diverge.
 */

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/** Raw, mergeable per-agent numbers for one window. */
export interface AgentAggregate {
  runs: number;
  /** Σ cost of runs with a known cost, full precision. */
  totalCostUsd: number;
  /** Runs with a known cost. */
  costedRuns: number;
  /** Successful runs with a known duration (duration averages are over these only). */
  durationRuns: number;
  durationSumMs: number;
  lastRunAt: Date | null;
  /** Runs whose cost was provider-reported / estimated. */
  apiRuns: number;
  estimateRuns: number;
  accepted: number;
  resolved: number;
}

export const EMPTY_AGGREGATE: AgentAggregate = {
  runs: 0,
  totalCostUsd: 0,
  costedRuns: 0,
  durationRuns: 0,
  durationSumMs: 0,
  lastRunAt: null,
  apiRuns: 0,
  estimateRuns: 0,
  accepted: 0,
  resolved: 0,
};

export function mergeAggregates(a: AgentAggregate, b: AgentAggregate): AgentAggregate {
  const later =
    a.lastRunAt && b.lastRunAt ? (a.lastRunAt > b.lastRunAt ? a.lastRunAt : b.lastRunAt) : (a.lastRunAt ?? b.lastRunAt);
  return {
    runs: a.runs + b.runs,
    totalCostUsd: a.totalCostUsd + b.totalCostUsd,
    costedRuns: a.costedRuns + b.costedRuns,
    durationRuns: a.durationRuns + b.durationRuns,
    durationSumMs: a.durationSumMs + b.durationSumMs,
    lastRunAt: later,
    apiRuns: a.apiRuns + b.apiRuns,
    estimateRuns: a.estimateRuns + b.estimateRuns,
    accepted: a.accepted + b.accepted,
    resolved: a.resolved + b.resolved,
  };
}

/** billed / estimated / mixed over runs with a recorded source; null when none. */
export function costSourceBadge(apiRuns: number, estimateRuns: number): CostSourceBadge | null {
  if (apiRuns > 0 && estimateRuns > 0) return "mixed";
  if (apiRuns > 0) return "billed";
  if (estimateRuns > 0) return "estimated";
  return null;
}

export interface AgentIdentity {
  /** null = the aggregated "Deleted agents" row. */
  id: string | null;
  name: string;
  enabled: boolean;
}

export function toAgentRow(
  identity: AgentIdentity,
  current: AgentAggregate,
  previous: AgentAggregate | undefined,
  recentRuns: RecentRun[],
): AgentPerfRow {
  const prev = previous ?? EMPTY_AGGREGATE;
  return {
    id: identity.id,
    name: identity.name,
    enabled: identity.enabled,
    runs: current.runs,
    totalCostUsd: current.totalCostUsd,
    avgCostUsd: current.costedRuns > 0 ? current.totalCostUsd / current.costedRuns : null,
    runsWithoutCost: current.runs - current.costedRuns,
    avgDurationMs: current.durationRuns > 0 ? current.durationSumMs / current.durationRuns : null,
    accept: { accepted: current.accepted, resolved: current.resolved },
    // null = no history at all in the previous window (nothing to compare to).
    previousAccept:
      prev.runs === 0 && prev.resolved === 0
        ? null
        : { accepted: prev.accepted, resolved: prev.resolved },
    lastRunAt: current.lastRunAt ? current.lastRunAt.toISOString() : null,
    costSource: costSourceBadge(current.apiRuns, current.estimateRuns),
    recentRuns,
  };
}

// ---------------------------------------------------------------------------
// KPI helpers
// ---------------------------------------------------------------------------

/**
 * Most-active agent among EXISTING agents: most runs, then the later last run,
 * then the name. "Deleted agents" (id null) and agents with no runs never win.
 */
export function pickMostActive(rows: AgentPerfRow[]): AgentPerfRow | null {
  const eligible = rows.filter((r) => r.id !== null && r.runs > 0);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (b.runs !== a.runs) return b.runs - a.runs;
    const la = a.lastRunAt ?? "";
    const lb = b.lastRunAt ?? "";
    if (la !== lb) return la < lb ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return eligible[0]!;
}

/**
 * Total-cost delta vs the previous window — only when history fully covers that
 * window (the workspace's first counted run is at or before its start), since a
 * sum over a partly-empty window would read as a fake saving.
 */
export function totalCostDelta(
  currentTotal: number,
  previousTotal: number,
  workspaceFirstRunAt: Date | null,
  previousFrom: Date,
): number | null {
  if (!workspaceFirstRunAt) return null;
  if (workspaceFirstRunAt.getTime() > previousFrom.getTime()) return null;
  return currentTotal - previousTotal;
}

/** Avg-cost delta — needs enough costed runs in the previous window (an average, not a sum). */
export function avgCostDelta(
  currentAvg: number | null,
  previous: Pick<AgentAggregate, "totalCostUsd" | "costedRuns">,
): number | null {
  if (currentAvg == null) return null;
  if (previous.costedRuns < MIN_PREV_COSTED_RUNS) return null;
  return currentAvg - previous.totalCostUsd / previous.costedRuns;
}

// ---------------------------------------------------------------------------
// Cost breakdown
// ---------------------------------------------------------------------------

export interface SegmentInput {
  key: string | null;
  label: string;
  costUsd: number;
  kind: "agent" | "model" | "deleted" | "unknown_model";
}

/**
 * Order by cost, drop $0 groups and fold the tail into one "Other" so there are
 * at most MAX_SEGMENTS segments and Σ segments still equals the total cost.
 */
export function collapseSegments(groups: SegmentInput[], noun: "agents" | "models"): CostSegment[] {
  const sorted = groups
    .filter((g) => g.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd || a.label.localeCompare(b.label));
  const toSegment = (g: SegmentInput): CostSegment => ({ ...g, hidden: [] });
  if (sorted.length <= MAX_SEGMENTS) return sorted.map(toSegment);

  const head = sorted.slice(0, MAX_SEGMENTS - 1);
  const tail = sorted.slice(MAX_SEGMENTS - 1);
  return [
    ...head.map(toSegment),
    {
      key: null,
      label: `Other (${tail.length} ${noun})`,
      costUsd: tail.reduce((sum, g) => sum + g.costUsd, 0),
      kind: "other",
      hidden: tail.map((g) => ({ label: g.label, costUsd: g.costUsd })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Findings charts
// ---------------------------------------------------------------------------

/** Always five entries, in the fixed display order, zero-filled. */
export function toCategoryCounts(rows: { category: string; n: number }[]): CategoryCount[] {
  const byCategory = new Map(rows.map((r) => [r.category, r.n]));
  return FINDING_CATEGORY_ORDER.map((category) => ({
    category,
    count: byCategory.get(category) ?? 0,
  }));
}

/** One entry per window bucket (zero-filled), keyed by the bucket index. */
export function toSeverityBuckets(
  buckets: StatsBucket[],
  rows: { idx: number; severity: string; n: number }[],
): SeverityBucket[] {
  return buckets.map((b, idx) => {
    const at = (sev: string) =>
      rows.find((r) => r.idx === idx && r.severity === sev)?.n ?? 0;
    return {
      ...b,
      critical: at("CRITICAL"),
      warning: at("WARNING"),
      suggestion: at("SUGGESTION"),
    };
  });
}

type FindingRow = typeof t.findings.$inferSelect;

export function toFindingRecord(row: FindingRow): FindingRecord {
  return {
    id: row.id,
    severity: row.severity as FindingRecord["severity"],
    category: row.category as FindingRecord["category"],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion ?? null,
    confidence: row.confidence,
    kind: (row.kind as FindingRecord["kind"]) ?? "finding",
    trifecta_components: (row.trifectaComponents as FindingRecord["trifecta_components"]) ?? null,
    evidence: null,
    review_id: row.reviewId,
    accepted_at: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    dismissed_at: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    rule_refs: row.ruleRefs ?? null,
  };
}

// ---------------------------------------------------------------------------
// Skill stats
// ---------------------------------------------------------------------------

/** Everything `SkillStatsResponse` carries except the window. */
export interface SkillStatsData {
  hasAnyRuns: boolean;
  loadedRunsInWindow: number;
  usedBy: number;
  ranInPeriod: number;
  prsApplied: number;
  prsLoaded: number;
  accept: AcceptFraction;
  findings: number;
  categories: { category: string; n: number }[];
  agents: { id: string; name: string; enabled: boolean }[];
}

export function toSkillStatsResponse(window: StatsWindow, d: SkillStatsData): SkillStatsResponse {
  return {
    window,
    hasAnyRuns: d.hasAnyRuns,
    loadedRunsInWindow: d.loadedRunsInWindow,
    usedBy: d.usedBy,
    ranInPeriod: d.ranInPeriod,
    pullFrequency: { prsApplied: d.prsApplied, prsLoaded: d.prsLoaded },
    accept: d.accept,
    findings: d.findings,
    categories: toCategoryCounts(d.categories),
    agents: d.agents,
  };
}
