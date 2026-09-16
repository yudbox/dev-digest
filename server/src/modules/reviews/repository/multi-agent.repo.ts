import { and, avg, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import * as t from "../../../db/schema.js";
import type {
  AgentColumn,
  AgentColumnFinding,
  MultiAgentRun,
  MultiAgentRunSummary,
} from "@devdigest/shared";
import { computeConflicts } from "../conflict-detection.js";

function encodeCursor(ranAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ ranAt: ranAt.toISOString(), id }),
  ).toString("base64");
}

function decodeCursor(cursor: string): { ranAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64").toString("utf8"),
    ) as { ranAt: string; id: string };
    return { ranAt: new Date(parsed.ranAt), id: parsed.id };
  } catch {
    return null;
  }
}

export async function createMultiAgentRun(
  db: Db,
  values: { workspaceId: string; prId: string; agentRunIds: string[] },
): Promise<typeof t.multiAgentRuns.$inferSelect> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning();
  if (!row) throw new Error("Failed to insert multi_agent_runs row");

  if (values.agentRunIds.length > 0) {
    await db
      .update(t.agentRuns)
      .set({ multiAgentRunId: row.id })
      .where(inArray(t.agentRuns.id, values.agentRunIds));
  }
  return row;
}

export async function getMultiAgentRunById(
  db: Db,
  id: string,
): Promise<MultiAgentRun | null> {
  const [run] = await db
    .select({
      id: t.multiAgentRuns.id,
      prId: t.multiAgentRuns.prId,
      ranAt: t.multiAgentRuns.ranAt,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
      repoFullName: t.repos.fullName,
      headSha: t.pullRequests.headSha,
    })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .leftJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
    .where(eq(t.multiAgentRuns.id, id));

  if (!run) return null;

  const agentRunRows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      provider: t.agentRuns.provider,
      model: t.agentRuns.model,
      status: t.agentRuns.status,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
    })
    .from(t.agentRuns)
    .where(eq(t.agentRuns.multiAgentRunId, id));

  if (agentRunRows.length === 0) {
    return {
      id: run.id,
      pr_id: run.prId,
      pr_number: run.prNumber,
      pr_title: run.prTitle,
      repo_full_name: run.repoFullName ?? null,
      head_sha: run.headSha ?? null,
      ran_at: run.ranAt.toISOString(),
      agent_count: 0,
      total_duration_ms: 0,
      total_cost_usd: null,
      columns: [],
      conflicts: [],
    };
  }

  const agentIds = agentRunRows
    .map((r) => r.agentId)
    .filter(Boolean) as string[];
  const runIds = agentRunRows.map((r) => r.id);

  const agentRows =
    agentIds.length > 0
      ? await db
          .select({ id: t.agents.id, name: t.agents.name })
          .from(t.agents)
          .where(inArray(t.agents.id, agentIds))
      : [];
  const agentNameMap = new Map(agentRows.map((a) => [a.id, a.name]));

  const avgDurationRows =
    agentIds.length > 0
      ? await db
          .select({
            agentId: t.agentRuns.agentId,
            avgDurationMs: avg(t.agentRuns.durationMs),
          })
          .from(t.agentRuns)
          .where(inArray(t.agentRuns.agentId, agentIds))
          .groupBy(t.agentRuns.agentId)
      : [];
  const avgDurationMap = new Map(
    avgDurationRows.map((r) => [r.agentId, r.avgDurationMs == null ? null : Number(r.avgDurationMs)]),
  );

  const reviewRows = await db
    .select()
    .from(t.reviews)
    .where(and(inArray(t.reviews.runId, runIds), eq(t.reviews.kind, "review")));

  const reviewIds = reviewRows.map((r) => r.id);
  const findingRows =
    reviewIds.length > 0
      ? await db
          .select()
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds))
      : [];

  const columns: AgentColumn[] = agentRunRows.map((ar) => {
    const review = reviewRows.find((r) => r.runId === ar.id);
    const findings = review
      ? findingRows.filter((f) => f.reviewId === review.id)
      : [];
    const agentId = ar.agentId ?? "";
    const agentName = agentNameMap.get(agentId) ?? "Unknown Agent";

    const columnFindings: AgentColumnFinding[] = findings.map((f) => ({
      id: f.id,
      review_id: review!.id,
      severity: f.severity as AgentColumnFinding["severity"],
      category: f.category as AgentColumnFinding["category"],
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
      rationale: f.rationale,
      suggestion: f.suggestion,
      confidence: f.confidence,
      kind: f.kind as AgentColumnFinding["kind"],
      trifecta_components: null,
      evidence: null,
      accepted_at: f.acceptedAt?.toISOString() ?? null,
      dismissed_at: f.dismissedAt?.toISOString() ?? null,
    }));

    return {
      run_id: ar.id,
      agent_id: agentId,
      agent_name: agentName,
      provider: ar.provider,
      model: ar.model,
      status: (ar.status as AgentColumn["status"]) ?? "running",
      verdict: review?.verdict ?? null,
      score: review?.score ?? null,
      summary: review?.summary ?? null,
      duration_ms: ar.durationMs,
      avg_duration_ms: avgDurationMap.get(agentId) ?? null,
      cost_usd: ar.costUsd,
      findings: columnFindings,
    };
  });

  const totalDurationMs = Math.max(
    0,
    ...agentRunRows.map((r) => r.durationMs ?? 0),
  );
  const totalCostUsd = agentRunRows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const conflicts = computeConflicts(columns, false);

  return {
    id: run.id,
    pr_id: run.prId,
    pr_number: run.prNumber,
    pr_title: run.prTitle,
    repo_full_name: run.repoFullName ?? null,
    head_sha: run.headSha ?? null,
    ran_at: run.ranAt.toISOString(),
    agent_count: agentRunRows.length,
    total_duration_ms: totalDurationMs,
    total_cost_usd: totalCostUsd > 0 ? totalCostUsd : null,
    columns,
    conflicts,
  };
}

export async function listMultiAgentRuns(
  db: Db,
  params: {
    workspaceId: string;
    limit?: number;
    cursor?: string;
    status?: string;
    q?: string;
  },
): Promise<{ items: MultiAgentRunSummary[]; next_cursor: string | null }> {
  const limit = Math.min(params.limit ?? 20, 100);
  const cursor = params.cursor ? decodeCursor(params.cursor) : null;

  const runsAgg = db
    .select({
      multiAgentRunId: t.agentRuns.multiAgentRunId,
      agentCount: count(t.agentRuns.id).as("agent_count"),
      totalDurationMs: max(t.agentRuns.durationMs).as("total_duration_ms"),
      totalCostUsd: sql<number>`COALESCE(SUM(${t.agentRuns.costUsd}), 0)`.as(
        "total_cost_usd",
      ),
      runStatus: sql<"running" | "failed" | "done">`
        CASE
          WHEN SUM(CASE WHEN ${t.agentRuns.status} = 'running' THEN 1 ELSE 0 END) > 0 THEN 'running'
          WHEN SUM(CASE WHEN ${t.agentRuns.status} = 'failed'  THEN 1 ELSE 0 END) > 0 THEN 'failed'
          ELSE 'done'
        END
      `.as("run_status"),
    })
    .from(t.agentRuns)
    .where(sql`${t.agentRuns.multiAgentRunId} IS NOT NULL`)
    .groupBy(t.agentRuns.multiAgentRunId)
    .as("runs_agg");

  // Build WHERE conditions
  const conditions: Parameters<typeof and>[0][] = [
    eq(t.multiAgentRuns.workspaceId, params.workspaceId),
  ];

  if (cursor) {
    conditions.push(
      sql`(${t.multiAgentRuns.ranAt}, ${t.multiAgentRuns.id}::text) < (${cursor.ranAt.toISOString()}::timestamptz, ${cursor.id})`,
    );
  }

  if (params.status) {
    conditions.push(sql`${runsAgg.runStatus} = ${params.status}`);
  }

  if (params.q) {
    const likeParam = `%${params.q}%`;
    conditions.push(
      sql`(${t.pullRequests.title} ILIKE ${likeParam} OR CAST(${t.pullRequests.number} AS TEXT) ILIKE ${likeParam})`,
    );
  }

  const rows = await db
    .select({
      id: t.multiAgentRuns.id,
      prId: t.multiAgentRuns.prId,
      ranAt: t.multiAgentRuns.ranAt,
      prNumber: t.pullRequests.number,
      prTitle: t.pullRequests.title,
      agentCount: runsAgg.agentCount,
      totalDurationMs: runsAgg.totalDurationMs,
      totalCostUsd: runsAgg.totalCostUsd,
      status: runsAgg.runStatus,
    })
    .from(t.multiAgentRuns)
    .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
    .leftJoin(runsAgg, eq(runsAgg.multiAgentRunId, t.multiAgentRuns.id))
    .where(and(...(conditions as [(typeof conditions)[0]])))
    .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);

  const summaries: MultiAgentRunSummary[] = items.map((r) => ({
    id: r.id,
    pr_id: r.prId,
    pr_number: r.prNumber,
    pr_title: r.prTitle,
    agent_count: r.agentCount ?? 0,
    total_duration_ms: r.totalDurationMs ?? null,
    total_cost_usd: r.totalCostUsd != null ? Number(r.totalCostUsd) : null,
    ran_at: r.ranAt.toISOString(),
    status: r.status ?? "done",
  }));

  let next_cursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1]!;
    next_cursor = encodeCursor(last.ranAt, last.id);
  }

  return { items: summaries, next_cursor };
}
