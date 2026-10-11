import type {
  AgentPerfRow,
  AgentPerformanceResponse,
  AgentRunsResponse,
  AgentStatsResponse,
  RecentRun,
  RunFindingsResponse,
  StatsWindow,
} from "@devdigest/shared";
import type { Container } from "../../platform/container.js";
import { NotFoundError } from "../../platform/errors.js";
import { RECENT_RUNS_PER_AGENT } from "./constants.js";
import type { PageQuery } from "./query.js";
import {
  EMPTY_AGGREGATE,
  avgCostDelta,
  collapseSegments,
  costSourceBadge,
  mergeAggregates,
  pickMostActive,
  toAgentRow,
  toCategoryCounts,
  toFindingRecord,
  toSeverityBuckets,
  totalCostDelta,
  type AgentAggregate,
  type SegmentInput,
} from "./helpers.js";
import type { PerformanceRepository, RecentRunRow, TimeRange } from "./repository.js";

/**
 * Performance service — assembles the three stats screens from the shared,
 * read-only aggregation. The dashboard row and the Agent Stats KPIs are both
 * built by `toAgentRow` from `agentAggregates`, so for the same agent and the
 * same window they are identical by construction.
 */

const range = (from: string, to: string): TimeRange => ({
  from: new Date(from),
  to: new Date(to),
});

const toRecentRun = (r: RecentRunRow): RecentRun => ({
  id: r.id,
  ranAt: r.ranAt.toISOString(),
  status: r.status,
  durationMs: r.durationMs,
  costUsd: r.costUsd,
});

/** Merge every aggregate whose agent id is null or no longer exists. */
function foldUnknown(
  all: Map<string | null, AgentAggregate>,
  known: Set<string>,
): AgentAggregate {
  let acc = EMPTY_AGGREGATE;
  for (const [id, agg] of all) {
    if (id === null || !known.has(id)) acc = mergeAggregates(acc, agg);
  }
  return acc;
}

export class PerformanceService {
  private repo: PerformanceRepository;

  constructor(container: Container) {
    this.repo = container.performanceRepo;
  }

  async dashboard(ws: string, window: StatsWindow): Promise<AgentPerformanceResponse> {
    const current = range(window.from, window.to);
    const previous = range(window.previous.from, window.previous.to);

    const [agents, curAgg, prevAgg, recent, sparkline, byModel, hasAnyRuns, firstRunAt, hasCi] =
      await Promise.all([
        this.repo.listAgents(ws),
        this.repo.agentAggregates(ws, current),
        this.repo.agentAggregates(ws, previous),
        this.repo.recentRunsPerAgent(ws, current),
        this.repo.runsPerBucket(ws, window.buckets),
        this.repo.costByModel(ws, current),
        this.repo.hasAnyRuns(ws),
        this.repo.workspaceFirstRunAt(ws),
        this.repo.hasCiInstallations(ws),
      ]);

    const known = new Set(agents.map((a) => a.id));
    const recentBy = new Map<string, RecentRun[]>();
    const recentDeleted: RecentRunRow[] = [];
    for (const r of recent) {
      if (r.agentId && known.has(r.agentId)) {
        const list = recentBy.get(r.agentId) ?? [];
        list.push(toRecentRun(r));
        recentBy.set(r.agentId, list);
      } else {
        recentDeleted.push(r);
      }
    }

    const rows: AgentPerfRow[] = agents.map((a) =>
      toAgentRow(
        { id: a.id, name: a.name, enabled: a.enabled },
        curAgg.get(a.id) ?? EMPTY_AGGREGATE,
        prevAgg.get(a.id),
        recentBy.get(a.id) ?? [],
      ),
    );

    // Runs / findings of agents that no longer exist: one extra row so that
    // Σ(table) always equals the KPIs.
    const deletedCur = foldUnknown(curAgg, known);
    if (deletedCur.runs > 0 || deletedCur.resolved > 0) {
      rows.push(
        toAgentRow(
          { id: null, name: "Deleted agents", enabled: false },
          deletedCur,
          foldUnknown(prevAgg, known),
          recentDeleted
            .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
            .slice(0, RECENT_RUNS_PER_AGENT)
            .map(toRecentRun),
        ),
      );
    }

    let totalRuns = 0;
    let totalCost = 0;
    let runsWithoutCost = 0;
    let accepted = 0;
    let resolved = 0;
    for (const r of rows) {
      totalRuns += r.runs;
      totalCost += r.totalCostUsd;
      runsWithoutCost += r.runsWithoutCost;
      accepted += r.accept.accepted;
      resolved += r.accept.resolved;
    }
    let apiRuns = 0;
    let estimateRuns = 0;
    let previousTotal = 0;
    for (const agg of curAgg.values()) {
      apiRuns += agg.apiRuns;
      estimateRuns += agg.estimateRuns;
    }
    for (const agg of prevAgg.values()) previousTotal += agg.totalCostUsd;

    const top = pickMostActive(rows);

    const agentSegments: SegmentInput[] = rows.map((r) => ({
      key: r.id,
      label: r.name,
      costUsd: r.totalCostUsd,
      kind: r.id === null ? "deleted" : "agent",
    }));
    const modelSegments: SegmentInput[] = byModel.map((m) => ({
      key: m.model,
      label: m.model ?? "Unknown model",
      costUsd: m.costUsd,
      kind: m.model === null ? "unknown_model" : "model",
    }));

    return {
      window,
      hasAnyRuns,
      hasCiInstallations: hasCi,
      kpis: {
        totalRuns,
        sparkline,
        totalCostUsd: totalCost,
        costSource: costSourceBadge(apiRuns, estimateRuns),
        runsWithoutCost,
        costDeltaUsd: totalCostDelta(totalCost, previousTotal, firstRunAt, new Date(window.previous.from)),
        accept: { accepted, resolved },
        mostActive: top
          ? { agentId: top.id!, name: top.name, runs: top.runs, accept: top.accept }
          : null,
      },
      agents: rows,
      costByAgent: collapseSegments(agentSegments, "agents"),
      costByModel: collapseSegments(modelSegments, "models"),
    };
  }

  async agentStats(ws: string, agentId: string, window: StatsWindow): Promise<AgentStatsResponse> {
    const agent = await this.repo.getAgent(ws, agentId);
    if (!agent) throw new NotFoundError("Agent not found");

    const current = range(window.from, window.to);
    const previous = range(window.previous.from, window.previous.to);

    const [
      curAgg,
      prevAgg,
      sparkline,
      severityRows,
      categoryRows,
      skills,
      memory,
      memoryTracked,
      tracking,
      hasSkills,
      hasAnyRuns,
      hasCi,
    ] = await Promise.all([
      this.repo.agentAggregates(ws, current, agentId),
      this.repo.agentAggregates(ws, previous, agentId),
      this.repo.runsPerBucket(ws, window.buckets, agentId),
      this.repo.severityBuckets(ws, window.buckets, agentId),
      this.repo.categoryCounts(ws, current, agentId),
      this.repo.skillUsage(ws, current, agentId),
      this.repo.memoryUsage(ws, current, agentId),
      this.repo.memoryTrackedRuns(ws, current, agentId),
      this.repo.trackingSince(ws, agentId),
      this.repo.agentHasSkills(agentId),
      this.repo.hasAnyRuns(ws, agentId),
      this.repo.hasCiInstallations(ws),
    ]);

    const cur = curAgg.get(agentId) ?? EMPTY_AGGREGATE;
    const prev = prevAgg.get(agentId) ?? EMPTY_AGGREGATE;
    const row = toAgentRow({ id: agent.id, name: agent.name, enabled: agent.enabled }, cur, prevAgg.get(agentId), []);
    const { id: _id, name: _name, enabled: _enabled, ...kpiFields } = row;

    const categories = toCategoryCounts(categoryRows);
    return {
      window,
      hasAnyRuns,
      hasCiInstallations: hasCi,
      agent: { id: agent.id, name: agent.name, enabled: agent.enabled },
      kpis: {
        ...kpiFields,
        sparkline,
        avgCostDeltaUsd: avgCostDelta(row.avgCostUsd, prev),
      },
      skills: skills.map((s) => ({ skillId: s.skillId, name: s.name, applied: s.applied, loaded: s.loaded })),
      memory: memory.map((m) => ({
        memoryId: m.memoryId,
        preview: m.preview,
        pulled: m.pulled,
        tracked: memoryTracked,
      })),
      hasSkillsAttached: hasSkills,
      skillsTrackingSince: tracking.skills ? tracking.skills.toISOString() : null,
      memoryTrackingSince: tracking.memory ? tracking.memory.toISOString() : null,
      severityBuckets: toSeverityBuckets(window.buckets, severityRows),
      findingsTotal: categories.reduce((sum, c) => sum + c.count, 0),
      categories,
    };
  }

  async agentRuns(
    ws: string,
    agentId: string,
    window: StatsWindow,
    page: PageQuery,
  ): Promise<AgentRunsResponse> {
    const agent = await this.repo.getAgent(ws, agentId);
    if (!agent) throw new NotFoundError("Agent not found");

    const result = await this.repo.runHistoryPage(
      ws,
      agentId,
      range(window.from, window.to),
      page.limit,
      page.cursor,
    );
    return {
      items: result.rows.map((r) => {
        const isCi = r.ciRunId !== null;
        const pr = isCi
          ? r.ciPrNumber !== null
            ? {
                number: r.ciPrNumber,
                repoId: null,
                githubUrl: r.ciRepo ? `https://github.com/${r.ciRepo}/pull/${r.ciPrNumber}` : null,
              }
            : null
          : r.prNumber !== null
            ? { number: r.prNumber, repoId: r.prRepoId, githubUrl: null }
            : null;
        return {
          id: r.id,
          ranAt: r.ranAt.toISOString(),
          status: r.status,
          error: r.error,
          pr,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          costUsd: r.costUsd,
          costSource: r.costSource,
          findingsCount: r.findingsCount,
          source: r.source,
          hasTrace: r.hasTrace,
          ciRunUrl: r.ciGithubUrl,
        };
      }),
      nextCursor: result.nextCursor,
    };
  }

  async runFindings(ws: string, runId: string): Promise<RunFindingsResponse> {
    const rows = await this.repo.runFindings(ws, runId);
    if (!rows) throw new NotFoundError("Run not found");
    return { items: rows.map(toFindingRecord) };
  }
}
