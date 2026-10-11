import { z } from "zod";
import { FindingCategory, FindingRecord } from "./findings";

/**
 * Performance / stats contracts (Agent Performance dashboard, Agent Stats tab,
 * Skill Stats tab, run history). Every read endpoint takes the same query and
 * returns a `window` resolved by the server in ONE place, so the three screens
 * always agree on bounds and buckets. All endpoints are GET-only and read-only.
 */

/** Fixed display order of the five finding categories (donut legend, API arrays). */
export const FINDING_CATEGORY_ORDER = [
  "security",
  "bug",
  "perf",
  "style",
  "test",
] as const;

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Raw querystring shared by the stats endpoints. Deliberately permissive (all
 * optional strings): strict validation happens in the server's
 * `parseStatsQuery()` so a bad value is a 400, not a framework 422.
 *   - `range`  : "1d" | "30d"      (preset)   — OR —
 *   - `from`/`to`: ISO instants, a custom range of at most 30 days
 *   - `tz`     : IANA time zone of the user (buckets are cut in local time)
 *   - `limit`/`cursor`: run-history paging only
 */
export const StatsQuery = z.object({
  range: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  tz: z.string().optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type StatsQuery = z.infer<typeof StatsQuery>;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Where a run's cost came from (stored on `agent_runs.cost_source`). */
export const CostSource = z.enum(["api", "estimate"]);
export type CostSource = z.infer<typeof CostSource>;

/** Cost-source badge computed over the runs in scope (never "unknown"). */
export const CostSourceBadge = z.enum(["billed", "estimated", "mixed"]);
export type CostSourceBadge = z.infer<typeof CostSourceBadge>;

/** How memory was selected for a run (stored on `agent_runs.memory_mode`). */
export const MemoryMode = z.enum(["top_k", "fallback"]);
export type MemoryMode = z.infer<typeof MemoryMode>;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export const StatsBucket = z.object({
  /** H1…H6 (hours), D1…Dn (days) or W1…W5 (weeks). */
  label: z.string(),
  /** ISO instants; the bucket is [start, end). */
  start: z.string(),
  end: z.string(),
  /** True for the last bucket when it is still in progress / shorter than nominal. */
  partial: z.boolean(),
});
export type StatsBucket = z.infer<typeof StatsBucket>;

export const StatsWindow = z.object({
  kind: z.enum(["1d", "30d", "custom"]),
  from: z.string(),
  to: z.string(),
  tz: z.string(),
  /** Nominal length in local days (1d → 1, 30d → 30, custom → D2−D1+1). */
  days: z.number().int(),
  bucketKind: z.enum(["hour", "day", "week"]),
  buckets: z.array(StatsBucket),
  /** Same nominal length, ending at `from`. */
  previous: z.object({ from: z.string(), to: z.string() }),
});
export type StatsWindow = z.infer<typeof StatsWindow>;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** accepted / resolved, where resolved = accepted + dismissed (local findings only). */
export const AcceptFraction = z.object({
  accepted: z.number().int(),
  resolved: z.number().int(),
});
export type AcceptFraction = z.infer<typeof AcceptFraction>;

export const RecentRun = z.object({
  id: z.string(),
  ranAt: z.string(),
  status: z.string().nullable(),
  durationMs: z.number().nullable(),
  costUsd: z.number().nullable(),
});
export type RecentRun = z.infer<typeof RecentRun>;

export const SeverityBucket = StatsBucket.extend({
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});
export type SeverityBucket = z.infer<typeof SeverityBucket>;

export const CategoryCount = z.object({
  category: FindingCategory,
  count: z.number().int(),
});
export type CategoryCount = z.infer<typeof CategoryCount>;

/** One donut segment of the cost breakdown. */
export const CostSegment = z.object({
  /** Agent id / model name; null for deleted-agents, unknown-model and other. */
  key: z.string().nullable(),
  label: z.string(),
  costUsd: z.number(),
  kind: z.enum(["agent", "model", "deleted", "unknown_model", "other"]),
  /** Only for kind = "other": the groups folded into it (tooltip). */
  hidden: z.array(z.object({ label: z.string(), costUsd: z.number() })),
});
export type CostSegment = z.infer<typeof CostSegment>;

/**
 * One row of the agent table. The same shape (plus extras) backs the Agent
 * Stats KPIs, so a dashboard row always equals that agent's Stats numbers.
 */
export const AgentPerfRow = z.object({
  /** null = the aggregated "Deleted agents" row. */
  id: z.string().nullable(),
  name: z.string(),
  enabled: z.boolean(),
  runs: z.number().int(),
  totalCostUsd: z.number(),
  /** Over runs with a known cost; null when there is none. */
  avgCostUsd: z.number().nullable(),
  runsWithoutCost: z.number().int(),
  /** Over successful runs only; null when there is none. */
  avgDurationMs: z.number().nullable(),
  accept: AcceptFraction,
  /**
   * Accept fraction of the previous window. null = the agent has no history
   * before the current window ("No data for previous period"); a fraction with
   * resolved < 5 means "Not enough decisions in previous period (N)".
   */
  previousAccept: AcceptFraction.nullable(),
  lastRunAt: z.string().nullable(),
  /** billed / estimated / mixed over runs with a recorded source; null = none. */
  costSource: CostSourceBadge.nullable(),
  /** Last ≤ 10 runs inside the window, newest first (row expand). */
  recentRuns: z.array(RecentRun),
});
export type AgentPerfRow = z.infer<typeof AgentPerfRow>;

// ---------------------------------------------------------------------------
// GET /agent-performance
// ---------------------------------------------------------------------------

export const AgentPerformanceResponse = z.object({
  window: StatsWindow,
  /** The workspace has at least one counted run, ever (drives the empty state). */
  hasAnyRuns: z.boolean(),
  hasCiInstallations: z.boolean(),
  kpis: z.object({
    totalRuns: z.number().int(),
    /** One count per window bucket. */
    sparkline: z.array(z.number().int()),
    totalCostUsd: z.number(),
    costSource: CostSourceBadge.nullable(),
    runsWithoutCost: z.number().int(),
    /** null when the previous window is not fully covered by history. */
    costDeltaUsd: z.number().nullable(),
    accept: AcceptFraction,
    /** Chosen among existing agents only (never "Deleted agents"). */
    mostActive: z
      .object({
        agentId: z.string(),
        name: z.string(),
        runs: z.number().int(),
        accept: AcceptFraction,
      })
      .nullable(),
  }),
  agents: z.array(AgentPerfRow),
  /** ≤ 7 segments each; Σ = totalCostUsd. */
  costByAgent: z.array(CostSegment),
  costByModel: z.array(CostSegment),
});
export type AgentPerformanceResponse = z.infer<typeof AgentPerformanceResponse>;

// ---------------------------------------------------------------------------
// GET /agents/:id/stats
// ---------------------------------------------------------------------------

export const AgentStatsResponse = z.object({
  window: StatsWindow,
  hasAnyRuns: z.boolean(),
  hasCiInstallations: z.boolean(),
  agent: z.object({ id: z.string(), name: z.string(), enabled: z.boolean() }),
  kpis: AgentPerfRow.omit({ id: true, name: true, enabled: true }).extend({
    sparkline: z.array(z.number().int()),
    /** null unless the previous window has ≥ 5 runs with a known cost. */
    avgCostDeltaUsd: z.number().nullable(),
  }),
  skills: z.array(
    z.object({
      skillId: z.string(),
      name: z.string(),
      applied: z.number().int(),
      loaded: z.number().int(),
    }),
  ),
  memory: z.array(
    z.object({
      memoryId: z.string(),
      preview: z.string(),
      pulled: z.number().int(),
      /** Runs of the agent in the window that have a recorded memory mode. */
      tracked: z.number().int(),
    }),
  ),
  hasSkillsAttached: z.boolean(),
  /** First run for which skill / memory usage was recorded ("No data before …"). */
  skillsTrackingSince: z.string().nullable(),
  memoryTrackingSince: z.string().nullable(),
  severityBuckets: z.array(SeverityBucket),
  findingsTotal: z.number().int(),
  /** Always 5 entries in FINDING_CATEGORY_ORDER. */
  categories: z.array(CategoryCount),
});
export type AgentStatsResponse = z.infer<typeof AgentStatsResponse>;

// ---------------------------------------------------------------------------
// GET /agents/:id/runs
// ---------------------------------------------------------------------------

export const AgentRunItem = z.object({
  id: z.string(),
  ranAt: z.string(),
  status: z.string().nullable(),
  error: z.string().nullable(),
  pr: z
    .object({
      number: z.number().int(),
      /** Local rows link to the in-app PR page; null for CI rows. */
      repoId: z.string().nullable(),
      /** CI rows link to GitHub; null for local rows. */
      githubUrl: z.string().nullable(),
    })
    .nullable(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  costSource: CostSource.nullable(),
  findingsCount: z.number().int().nullable(),
  source: z.enum(["local", "ci"]),
  hasTrace: z.boolean(),
  /** GitHub URL of the CI run for CI rows linked to a CI run. */
  ciRunUrl: z.string().nullable(),
});
export type AgentRunItem = z.infer<typeof AgentRunItem>;

export const AgentRunsResponse = z.object({
  items: z.array(AgentRunItem),
  nextCursor: z.string().nullable(),
});
export type AgentRunsResponse = z.infer<typeof AgentRunsResponse>;

// ---------------------------------------------------------------------------
// GET /skills/:id/stats
// ---------------------------------------------------------------------------

export const SkillStatsResponse = z.object({
  window: StatsWindow,
  /** The skill has been loaded into at least one counted run, ever. */
  hasAnyRuns: z.boolean(),
  /** Counted runs inside the window in which the skill was loaded. */
  loadedRunsInWindow: z.number().int(),
  /** Agents that currently have the skill attached (period-independent). */
  usedBy: z.number().int(),
  /** Of those, agents with at least one run in the window with the skill loaded. */
  ranInPeriod: z.number().int(),
  /** Local runs only. */
  pullFrequency: z.object({
    prsApplied: z.number().int(),
    prsLoaded: z.number().int(),
  }),
  accept: AcceptFraction,
  findings: z.number().int(),
  /** Always 5 entries in FINDING_CATEGORY_ORDER. */
  categories: z.array(CategoryCount),
  agents: z.array(
    z.object({ id: z.string(), name: z.string(), enabled: z.boolean() }),
  ),
});
export type SkillStatsResponse = z.infer<typeof SkillStatsResponse>;

// ---------------------------------------------------------------------------
// GET /runs/:id/findings
// ---------------------------------------------------------------------------

export const RunFindingsResponse = z.object({
  items: z.array(FindingRecord),
});
export type RunFindingsResponse = z.infer<typeof RunFindingsResponse>;
