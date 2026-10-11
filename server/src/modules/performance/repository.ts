import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { StatsBucket } from "@devdigest/shared";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import {
  COUNTED_STATUSES,
  MEMORY_BARS_MAX,
  MEMORY_PREVIEW_CHARS,
  RECENT_RUNS_PER_AGENT,
  SUCCESS_STATUSES,
} from "./constants.js";
import { encodeCursor, type RunCursor } from "./cursor.js";
import type { AgentAggregate, SkillStatsData } from "./helpers.js";

/**
 * Performance data-access. READ-ONLY: every method is a SELECT. All numbers a
 * stats screen shows come from here, through `agentAggregates` for per-agent
 * values, so a dashboard row and that agent's Stats tab cannot disagree.
 *
 * Query count per endpoint is fixed (buckets are passed as a VALUES list and
 * recent runs use row_number()), never one query per agent.
 */

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface AgentRef {
  id: string;
  name: string;
  enabled: boolean;
}

export interface RecentRunRow {
  agentId: string | null;
  id: string;
  ranAt: Date;
  status: string | null;
  durationMs: number | null;
  costUsd: number | null;
}

export interface SkillUsageRow {
  skillId: string;
  name: string;
  applied: number;
  loaded: number;
}

export interface MemoryUsageRow {
  memoryId: string;
  preview: string;
  pulled: number;
}

export interface RunHistoryRow {
  id: string;
  ranAt: Date;
  status: string | null;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  costSource: "api" | "estimate" | null;
  findingsCount: number | null;
  source: "local" | "ci";
  hasTrace: boolean;
  prNumber: number | null;
  prRepoId: string | null;
  ciRunId: string | null;
  ciPrNumber: number | null;
  ciGithubUrl: string | null;
  ciRepo: string | null;
}

export interface RunHistoryPage {
  rows: RunHistoryRow[];
  nextCursor: string | null;
}

// ---- SQL fragments -------------------------------------------------------

const list = (xs: readonly string[]): SQL =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );
const COUNTED = list(COUNTED_STATUSES);
const SUCCESS = list(SUCCESS_STATUSES);
const tstz = (d: Date | string): SQL =>
  sql`${typeof d === "string" ? d : d.toISOString()}::timestamptz`;

/**
 * Local findings with the attribution rule shared by every metric: a finding
 * belongs to the agent and run time of the run that produced its review; when
 * the review has no (existing) run link it falls back to the review's own
 * agent and creation time. A finding linked to a run that does not count
 * (running / cancelled) is excluded.
 */
function localFindingsCte(ws: string): SQL {
  return sql`local_findings AS (
    SELECT f.id, f.severity, f.category, f.accepted_at, f.dismissed_at, f.rule_refs,
           COALESCE(ar.agent_id, r.agent_id) AS agent_id,
           COALESCE(ar.ran_at, r.created_at) AS at
    FROM findings f
    JOIN reviews r ON r.id = f.review_id
    LEFT JOIN agent_runs ar ON ar.id = r.run_id
    WHERE r.workspace_id = ${ws}::uuid
      AND (ar.id IS NULL OR ar.status IN (${COUNTED}))
  )`;
}

/** Local + CI findings of ONE agent, as (severity, category, at) rows. */
function agentFindingsCtes(ws: string, agentId: string): SQL {
  return sql`${localFindingsCte(ws)},
  agent_findings AS (
    SELECT severity, category, at FROM local_findings WHERE agent_id = ${agentId}::uuid
    UNION ALL
    SELECT cf.severity, cf.category, ar.ran_at AS at
    FROM ci_run_findings cf
    JOIN agent_runs ar ON ar.ci_run_id = cf.ci_run_id
    WHERE ar.workspace_id = ${ws}::uuid
      AND ar.agent_id = ${agentId}::uuid
      AND ar.status IN (${COUNTED})
  )`;
}

function bucketValues(buckets: StatsBucket[]): SQL {
  const rows = buckets.map(
    (b, i) => sql`(${i}::int, ${b.start}::timestamptz, ${b.end}::timestamptz)`,
  );
  return sql`b(idx, s, e) AS (VALUES ${sql.join(rows, sql`, `)})`;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
/** Raw `db.execute` returns timestamptz as strings (no Drizzle column mapping). */
const toDate = (v: Date | string | null | undefined): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export class PerformanceRepository {
  constructor(private db: Db) {}

  // ---- workspace / agent facts -------------------------------------------

  async listAgents(ws: string): Promise<AgentRef[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name, enabled: t.agents.enabled })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, ws))
      .orderBy(asc(t.agents.name));
  }

  async getAgent(ws: string, agentId: string): Promise<AgentRef | undefined> {
    const [row] = await this.db
      .select({ id: t.agents.id, name: t.agents.name, enabled: t.agents.enabled })
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, ws)));
    return row;
  }

  /** The workspace has at least one counted run, ever. */
  async hasAnyRuns(ws: string, agentId?: string): Promise<boolean> {
    const agent = agentId ? sql`AND agent_id = ${agentId}::uuid` : sql``;
    const rows = await this.db.execute<{ v: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM agent_runs
        WHERE workspace_id = ${ws}::uuid AND status IN (${COUNTED}) ${agent}
      ) AS v`);
    return rows[0]?.v === true;
  }

  async workspaceFirstRunAt(ws: string): Promise<Date | null> {
    const rows = await this.db.execute<{ first: Date | null }>(sql`
      SELECT min(ran_at) AS first FROM agent_runs
      WHERE workspace_id = ${ws}::uuid AND status IN (${COUNTED})`);
    return toDate(rows[0]?.first);
  }

  async hasCiInstallations(ws: string): Promise<boolean> {
    const rows = await this.db.execute<{ v: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM ci_installations ci
        JOIN agents a ON a.id = ci.agent_id
        WHERE a.workspace_id = ${ws}::uuid
      ) AS v`);
    return rows[0]?.v === true;
  }

  async agentHasSkills(agentId: string): Promise<boolean> {
    const rows = await this.db.execute<{ v: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM agent_skills WHERE agent_id = ${agentId}::uuid) AS v`);
    return rows[0]?.v === true;
  }

  // ---- the shared aggregation --------------------------------------------

  /**
   * Per-agent runs / cost / duration / last run / accept numbers for ONE window
   * (or all time when `range` is null). This is THE aggregation: dashboard rows,
   * Agent Stats KPIs and the all-time Agents list all read it. Keyed by the raw
   * agent id; `null` collects runs whose agent was deleted.
   */
  async agentAggregates(
    ws: string,
    range: TimeRange | null,
    agentId?: string,
  ): Promise<Map<string | null, AgentAggregate>> {
    const runRange = range
      ? sql`AND ran_at >= ${tstz(range.from)} AND ran_at < ${tstz(range.to)}`
      : sql``;
    const findingRange = range
      ? sql`AND at >= ${tstz(range.from)} AND at < ${tstz(range.to)}`
      : sql``;
    const agent = agentId ? sql`AND agent_id = ${agentId}::uuid` : sql``;

    const rows = await this.db.execute<{
      agent_id: string | null;
      runs: number;
      total_cost: number;
      costed_runs: number;
      duration_runs: number;
      duration_sum: number;
      last_run_at: Date | null;
      api_runs: number;
      estimate_runs: number;
      accepted: number;
      resolved: number;
    }>(sql`
      WITH ${localFindingsCte(ws)},
      runs AS (
        SELECT agent_id,
               count(*)::int AS runs,
               COALESCE(sum(cost_usd::numeric), 0)::float8 AS total_cost,
               count(cost_usd)::int AS costed_runs,
               (count(duration_ms) FILTER (WHERE status IN (${SUCCESS})))::int AS duration_runs,
               COALESCE(sum(duration_ms) FILTER (WHERE status IN (${SUCCESS})), 0)::float8 AS duration_sum,
               max(ran_at) AS last_run_at,
               (count(*) FILTER (WHERE cost_source = 'api'))::int AS api_runs,
               (count(*) FILTER (WHERE cost_source = 'estimate'))::int AS estimate_runs
        FROM agent_runs
        WHERE workspace_id = ${ws}::uuid AND status IN (${COUNTED}) ${runRange} ${agent}
        GROUP BY agent_id
      ),
      fnd AS (
        SELECT agent_id,
               (count(*) FILTER (WHERE accepted_at IS NOT NULL))::int AS accepted,
               (count(*) FILTER (WHERE accepted_at IS NOT NULL OR dismissed_at IS NOT NULL))::int AS resolved
        FROM local_findings
        WHERE true ${findingRange} ${agent}
        GROUP BY agent_id
      )
      SELECT agent_id,
             sum(runs)::int AS runs,
             sum(total_cost)::float8 AS total_cost,
             sum(costed_runs)::int AS costed_runs,
             sum(duration_runs)::int AS duration_runs,
             sum(duration_sum)::float8 AS duration_sum,
             max(last_run_at) AS last_run_at,
             sum(api_runs)::int AS api_runs,
             sum(estimate_runs)::int AS estimate_runs,
             sum(accepted)::int AS accepted,
             sum(resolved)::int AS resolved
      FROM (
        SELECT agent_id, runs, total_cost, costed_runs, duration_runs, duration_sum,
               last_run_at, api_runs, estimate_runs, 0 AS accepted, 0 AS resolved
        FROM runs
        UNION ALL
        SELECT agent_id, 0, 0::float8, 0, 0, 0::float8,
               NULL::timestamptz, 0, 0, accepted, resolved
        FROM fnd
      ) u
      GROUP BY agent_id`);

    const out = new Map<string | null, AgentAggregate>();
    for (const r of rows) {
      out.set(r.agent_id, {
        runs: num(r.runs),
        totalCostUsd: num(r.total_cost),
        costedRuns: num(r.costed_runs),
        durationRuns: num(r.duration_runs),
        durationSumMs: num(r.duration_sum),
        lastRunAt: toDate(r.last_run_at),
        apiRuns: num(r.api_runs),
        estimateRuns: num(r.estimate_runs),
        accepted: num(r.accepted),
        resolved: num(r.resolved),
      });
    }
    return out;
  }

  // ---- time series --------------------------------------------------------

  /** Counted runs per window bucket (sparkline); optionally for one agent. */
  async runsPerBucket(ws: string, buckets: StatsBucket[], agentId?: string): Promise<number[]> {
    const agent = agentId ? sql`AND ar.agent_id = ${agentId}::uuid` : sql``;
    const rows = await this.db.execute<{ idx: number; n: number }>(sql`
      WITH ${bucketValues(buckets)}
      SELECT b.idx, count(ar.id)::int AS n
      FROM b
      LEFT JOIN agent_runs ar
        ON ar.workspace_id = ${ws}::uuid
       AND ar.status IN (${COUNTED})
       AND ar.ran_at >= b.s AND ar.ran_at < b.e
       ${agent}
      GROUP BY b.idx
      ORDER BY b.idx`);
    const out = buckets.map(() => 0);
    for (const r of rows) out[num(r.idx)] = num(r.n);
    return out;
  }

  /** Severity counts per bucket for one agent (local + CI findings). */
  async severityBuckets(
    ws: string,
    buckets: StatsBucket[],
    agentId: string,
  ): Promise<{ idx: number; severity: string; n: number }[]> {
    const rows = await this.db.execute<{ idx: number; severity: string; n: number }>(sql`
      WITH ${bucketValues(buckets)}, ${agentFindingsCtes(ws, agentId)}
      SELECT b.idx, f.severity, count(*)::int AS n
      FROM agent_findings f
      JOIN b ON f.at >= b.s AND f.at < b.e
      GROUP BY b.idx, f.severity`);
    return rows.map((r) => ({ idx: num(r.idx), severity: r.severity, n: num(r.n) }));
  }

  /** Category counts of one agent's findings in the window (local + CI). */
  async categoryCounts(
    ws: string,
    range: TimeRange,
    agentId: string,
  ): Promise<{ category: string; n: number }[]> {
    const rows = await this.db.execute<{ category: string; n: number }>(sql`
      WITH ${agentFindingsCtes(ws, agentId)}
      SELECT category, count(*)::int AS n
      FROM agent_findings
      WHERE at >= ${tstz(range.from)} AND at < ${tstz(range.to)}
      GROUP BY category`);
    return rows.map((r) => ({ category: r.category, n: num(r.n) }));
  }

  // ---- dashboard extras ---------------------------------------------------

  /** Cost by the run's own model (so Σ equals total cost). Unknown model → null. */
  async costByModel(
    ws: string,
    range: TimeRange,
  ): Promise<{ model: string | null; costUsd: number }[]> {
    const rows = await this.db.execute<{ model: string | null; cost: number }>(sql`
      SELECT model, sum(cost_usd::numeric)::float8 AS cost
      FROM agent_runs
      WHERE workspace_id = ${ws}::uuid
        AND status IN (${COUNTED})
        AND cost_usd IS NOT NULL
        AND ran_at >= ${tstz(range.from)} AND ran_at < ${tstz(range.to)}
      GROUP BY model`);
    return rows.map((r) => ({ model: r.model, costUsd: num(r.cost) }));
  }

  /** Last ≤ 10 runs inside the window per agent (row expand). Key null = deleted agents. */
  async recentRunsPerAgent(ws: string, range: TimeRange): Promise<RecentRunRow[]> {
    const rows = await this.db.execute<{
      id: string;
      agent_id: string | null;
      ran_at: Date;
      status: string | null;
      duration_ms: number | null;
      cost_usd: number | null;
    }>(sql`
      SELECT id, agent_id, ran_at, status, duration_ms, cost_usd
      FROM (
        SELECT id, agent_id, ran_at, status, duration_ms, cost_usd,
               row_number() OVER (PARTITION BY agent_id ORDER BY ran_at DESC, id DESC) AS rn
        FROM agent_runs
        WHERE workspace_id = ${ws}::uuid
          AND status IN (${COUNTED})
          AND ran_at >= ${tstz(range.from)} AND ran_at < ${tstz(range.to)}
      ) x
      WHERE rn <= ${RECENT_RUNS_PER_AGENT}
      ORDER BY ran_at DESC, id DESC`);
    return rows.map((r) => ({
      agentId: r.agent_id,
      id: r.id,
      ranAt: toDate(r.ran_at)!,
      status: r.status,
      durationMs: numOrNull(r.duration_ms),
      costUsd: numOrNull(r.cost_usd),
    }));
  }

  // ---- agent stats extras --------------------------------------------------

  async skillUsage(ws: string, range: TimeRange, agentId: string): Promise<SkillUsageRow[]> {
    const rows = await this.db.execute<{ skill_id: string; name: string; loaded: number; applied: number }>(sql`
      SELECT s.id AS skill_id, s.name,
             count(*)::int AS loaded,
             (count(*) FILTER (WHERE ars.applied))::int AS applied
      FROM agent_run_skills ars
      JOIN agent_runs ar ON ar.id = ars.run_id
      JOIN skills s ON s.id = ars.skill_id
      WHERE ar.workspace_id = ${ws}::uuid
        AND ar.agent_id = ${agentId}::uuid
        AND ar.status IN (${COUNTED})
        AND ar.ran_at >= ${tstz(range.from)} AND ar.ran_at < ${tstz(range.to)}
      GROUP BY s.id, s.name
      ORDER BY (count(*) FILTER (WHERE ars.applied))::float8 / count(*) DESC, s.name`);
    return rows.map((r) => ({
      skillId: r.skill_id,
      name: r.name,
      applied: num(r.applied),
      loaded: num(r.loaded),
    }));
  }

  /** Runs of the agent in the window that have a recorded memory-selection mode. */
  async memoryTrackedRuns(ws: string, range: TimeRange, agentId: string): Promise<number> {
    const rows = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM agent_runs
      WHERE workspace_id = ${ws}::uuid
        AND agent_id = ${agentId}::uuid
        AND status IN (${COUNTED})
        AND memory_mode IS NOT NULL
        AND ran_at >= ${tstz(range.from)} AND ran_at < ${tstz(range.to)}`);
    return num(rows[0]?.n);
  }

  async memoryUsage(ws: string, range: TimeRange, agentId: string): Promise<MemoryUsageRow[]> {
    const rows = await this.db.execute<{ memory_id: string; preview: string; pulled: number }>(sql`
      SELECT m.id AS memory_id,
             left(m.content, ${MEMORY_PREVIEW_CHARS}) AS preview,
             count(*)::int AS pulled
      FROM agent_run_memory arm
      JOIN agent_runs ar ON ar.id = arm.run_id
      JOIN memory m ON m.id = arm.memory_id
      WHERE ar.workspace_id = ${ws}::uuid
        AND ar.agent_id = ${agentId}::uuid
        AND ar.status IN (${COUNTED})
        AND ar.ran_at >= ${tstz(range.from)} AND ar.ran_at < ${tstz(range.to)}
      GROUP BY m.id, m.content
      ORDER BY pulled DESC, m.id
      LIMIT ${MEMORY_BARS_MAX}`);
    return rows.map((r) => ({ memoryId: r.memory_id, preview: r.preview, pulled: num(r.pulled) }));
  }

  /** First run for which skill / memory usage was recorded ("No data before …"). */
  async trackingSince(
    ws: string,
    agentId: string,
  ): Promise<{ skills: Date | null; memory: Date | null }> {
    const rows = await this.db.execute<{ skills_since: Date | null; memory_since: Date | null }>(sql`
      SELECT
        (SELECT min(ar.ran_at) FROM agent_runs ar
          WHERE ar.workspace_id = ${ws}::uuid AND ar.agent_id = ${agentId}::uuid
            AND ar.status IN (${COUNTED})
            AND EXISTS (SELECT 1 FROM agent_run_skills s WHERE s.run_id = ar.id)) AS skills_since,
        (SELECT min(ar.ran_at) FROM agent_runs ar
          WHERE ar.workspace_id = ${ws}::uuid AND ar.agent_id = ${agentId}::uuid
            AND ar.status IN (${COUNTED})
            AND ar.memory_mode IS NOT NULL) AS memory_since`);
    return { skills: toDate(rows[0]?.skills_since), memory: toDate(rows[0]?.memory_since) };
  }

  // ---- run history ---------------------------------------------------------

  /** One cursor page of an agent's counted runs in the window, newest first. */
  async runHistoryPage(
    ws: string,
    agentId: string,
    range: TimeRange,
    limit: number,
    cursor: RunCursor | null,
  ): Promise<RunHistoryPage> {
    const after = cursor
      ? sql`AND (ar.ran_at, ar.id) < (${tstz(cursor.ranAt)}, ${cursor.id}::uuid)`
      : sql``;
    const rows = await this.db.execute<{
      id: string;
      ran_at: Date;
      ran_at_cursor: string;
      status: string | null;
      error: string | null;
      tokens_in: number | null;
      tokens_out: number | null;
      cost_usd: number | null;
      cost_source: "api" | "estimate" | null;
      findings_count: number | null;
      source: "local" | "ci";
      has_trace: boolean;
      pr_number: number | null;
      pr_repo_id: string | null;
      ci_run_id: string | null;
      ci_pr_number: number | null;
      ci_github_url: string | null;
      ci_repo: string | null;
    }>(sql`
      SELECT ar.id, ar.ran_at,
             to_char(ar.ran_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ran_at_cursor,
             ar.status, ar.error, ar.tokens_in, ar.tokens_out, ar.cost_usd, ar.cost_source,
             ar.findings_count, ar.source,
             EXISTS (SELECT 1 FROM run_traces rt WHERE rt.run_id = ar.id) AS has_trace,
             pr.number AS pr_number, pr.repo_id AS pr_repo_id,
             ar.ci_run_id, cr.pr_number AS ci_pr_number, cr.github_url AS ci_github_url,
             inst.repo AS ci_repo
      FROM agent_runs ar
      LEFT JOIN pull_requests pr ON pr.id = ar.pr_id
      LEFT JOIN ci_runs cr ON cr.id = ar.ci_run_id
      LEFT JOIN ci_installations inst ON inst.id = cr.ci_installation_id
      WHERE ar.workspace_id = ${ws}::uuid
        AND ar.agent_id = ${agentId}::uuid
        AND ar.status IN (${COUNTED})
        AND ar.ran_at >= ${tstz(range.from)} AND ar.ran_at < ${tstz(range.to)}
        ${after}
      ORDER BY ar.ran_at DESC, ar.id DESC
      LIMIT ${limit + 1}`);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page.map((r) => ({
        id: r.id,
        ranAt: toDate(r.ran_at)!,
        status: r.status,
        error: r.error,
        tokensIn: numOrNull(r.tokens_in),
        tokensOut: numOrNull(r.tokens_out),
        costUsd: numOrNull(r.cost_usd),
        costSource: r.cost_source,
        findingsCount: numOrNull(r.findings_count),
        source: r.source,
        hasTrace: r.has_trace === true,
        prNumber: numOrNull(r.pr_number),
        prRepoId: r.pr_repo_id,
        ciRunId: r.ci_run_id,
        ciPrNumber: numOrNull(r.ci_pr_number),
        ciGithubUrl: r.ci_github_url,
        ciRepo: r.ci_repo,
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ ranAt: last.ran_at_cursor, id: last.id }) : null,
    };
  }

  /** Findings of one run (trace drawer). undefined = the run is not in this workspace. */
  async runFindings(ws: string, runId: string): Promise<(typeof t.findings.$inferSelect)[] | undefined> {
    const [run] = await this.db
      .select({ id: t.agentRuns.id })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, ws)));
    if (!run) return undefined;
    const rows = await this.db
      .select({ f: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, ws)))
      .orderBy(asc(t.findings.file), asc(t.findings.startLine));
    return rows.map((r) => r.f);
  }

  // ---- skills ---------------------------------------------------------------

  /** Skill Stats numbers for the window. undefined = the skill is not in this workspace. */
  async skillStats(
    ws: string,
    skillId: string,
    range: TimeRange,
  ): Promise<SkillStatsData | undefined> {
    const [skill] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.id, skillId), eq(t.skills.workspaceId, ws)));
    if (!skill) return undefined;

    const attached = await this.db
      .select({ id: t.agents.id, name: t.agents.name, enabled: t.agents.enabled })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, ws)))
      .orderBy(asc(t.agents.name));

    const [everRan, inWindow, byCategory] = await Promise.all([
      this.db.execute<{ v: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM agent_run_skills ars
          JOIN agent_runs ar ON ar.id = ars.run_id
          WHERE ars.skill_id = ${skillId}::uuid
            AND ar.workspace_id = ${ws}::uuid
            AND ar.status IN (${COUNTED})
        ) AS v`),
      this.db.execute<{
        loaded_runs: number;
        ran_in_period: number;
        prs_applied: number;
        prs_loaded: number;
      }>(sql`
        SELECT count(*)::int AS loaded_runs,
               (count(DISTINCT ar.agent_id) FILTER (WHERE EXISTS (
                  SELECT 1 FROM agent_skills ask
                  WHERE ask.agent_id = ar.agent_id AND ask.skill_id = ars.skill_id)))::int AS ran_in_period,
               (count(DISTINCT ar.pr_id) FILTER (
                  WHERE ar.source = 'local' AND ar.pr_id IS NOT NULL AND ars.applied))::int AS prs_applied,
               (count(DISTINCT ar.pr_id) FILTER (
                  WHERE ar.source = 'local' AND ar.pr_id IS NOT NULL))::int AS prs_loaded
        FROM agent_run_skills ars
        JOIN agent_runs ar ON ar.id = ars.run_id
        WHERE ars.skill_id = ${skillId}::uuid
          AND ar.workspace_id = ${ws}::uuid
          AND ar.status IN (${COUNTED})
          AND ar.ran_at >= ${tstz(range.from)} AND ar.ran_at < ${tstz(range.to)}`),
      this.db.execute<{ category: string; n: number; accepted: number; resolved: number }>(sql`
        WITH ${localFindingsCte(ws)}
        SELECT category,
               count(*)::int AS n,
               (count(*) FILTER (WHERE accepted_at IS NOT NULL))::int AS accepted,
               (count(*) FILTER (WHERE accepted_at IS NOT NULL OR dismissed_at IS NOT NULL))::int AS resolved
        FROM local_findings
        WHERE rule_refs @> ARRAY[${skillId}::uuid]
          AND at >= ${tstz(range.from)} AND at < ${tstz(range.to)}
        GROUP BY category`),
    ]);

    const w = inWindow[0];
    return {
      hasAnyRuns: everRan[0]?.v === true,
      loadedRunsInWindow: num(w?.loaded_runs),
      usedBy: attached.length,
      ranInPeriod: num(w?.ran_in_period),
      prsApplied: num(w?.prs_applied),
      prsLoaded: num(w?.prs_loaded),
      accept: {
        accepted: byCategory.reduce((s, r) => s + num(r.accepted), 0),
        resolved: byCategory.reduce((s, r) => s + num(r.resolved), 0),
      },
      findings: byCategory.reduce((s, r) => s + num(r.n), 0),
      categories: byCategory.map((r) => ({ category: r.category, n: num(r.n) })),
      agents: attached,
    };
  }

  /**
   * All-time, batched per-skill numbers for the skills list page — same
   * definitions as `skillStats`, no window. One query for every skill.
   */
  async skillAggregatesAllTime(
    ws: string,
  ): Promise<Map<string, { prsApplied: number; prsLoaded: number; accepted: number; resolved: number }>> {
    const rows = await this.db.execute<{
      skill_id: string;
      prs_applied: number | null;
      prs_loaded: number | null;
      accepted: number | null;
      resolved: number | null;
    }>(sql`
      WITH ${localFindingsCte(ws)},
      pf AS (
        SELECT ars.skill_id,
               (count(DISTINCT ar.pr_id) FILTER (WHERE ars.applied))::int AS prs_applied,
               count(DISTINCT ar.pr_id)::int AS prs_loaded
        FROM agent_run_skills ars
        JOIN agent_runs ar ON ar.id = ars.run_id
        WHERE ar.workspace_id = ${ws}::uuid
          AND ar.source = 'local'
          AND ar.pr_id IS NOT NULL
          AND ar.status IN (${COUNTED})
        GROUP BY ars.skill_id
      ),
      acc AS (
        SELECT ref AS skill_id,
               (count(*) FILTER (WHERE lf.accepted_at IS NOT NULL))::int AS accepted,
               (count(*) FILTER (WHERE lf.accepted_at IS NOT NULL OR lf.dismissed_at IS NOT NULL))::int AS resolved
        FROM local_findings lf
        CROSS JOIN LATERAL unnest(lf.rule_refs) AS ref
        GROUP BY ref
      )
      SELECT COALESCE(pf.skill_id, acc.skill_id) AS skill_id,
             pf.prs_applied, pf.prs_loaded, acc.accepted, acc.resolved
      FROM pf FULL OUTER JOIN acc ON pf.skill_id = acc.skill_id`);

    return new Map(
      rows.map((r) => [
        r.skill_id,
        {
          prsApplied: num(r.prs_applied),
          prsLoaded: num(r.prs_loaded),
          accepted: num(r.accepted),
          resolved: num(r.resolved),
        },
      ]),
    );
  }
}
