import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));

  // Per-severity counts: findings → reviews (via run_id) → agent_runs
  const runIds = rows.map((r) => r.run.id).filter(Boolean);
  const severityMap = new Map<string, { critical: number; warning: number; suggestion: number }>();
  if (runIds.length > 0) {
    const sevRows = await db
      .select({
        runId: t.reviews.runId,
        severity: t.findings.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(inArray(t.reviews.runId, runIds))
      .groupBy(t.reviews.runId, t.findings.severity);
    for (const row of sevRows) {
      if (!row.runId) continue;
      const entry = severityMap.get(row.runId) ?? { critical: 0, warning: 0, suggestion: 0 };
      if (row.severity === 'CRITICAL') entry.critical = row.count;
      else if (row.severity === 'WARNING') entry.warning = row.count;
      else if (row.severity === 'SUGGESTION') entry.suggestion = row.count;
      severityMap.set(row.runId, entry);
    }
  }

  return rows.map(({ run, agentName }) => {
    const sev = severityMap.get(run.id) ?? { critical: 0, warning: 0, suggestion: 0 };
    return {
      run_id: run.id,
      agent_id: run.agentId,
      agent_name: agentName ?? null,
      provider: run.provider,
      model: run.model,
      status: run.status,
      error: run.error,
      duration_ms: run.durationMs,
      tokens_in: run.tokensIn,
      tokens_out: run.tokensOut,
      cost_usd: run.costUsd,
      findings_count: run.findingsCount,
      grounding: run.grounding,
      ran_at: run.ranAt ? run.ranAt.toISOString() : null,
      score: run.score,
      blockers: run.blockers,
      findings_critical: sev.critical,
      findings_warning: sev.warning,
      findings_suggestion: sev.suggestion,
    };
  });
}

/** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Mark a still-running run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

export async function completeAgentRun(
  db: Db,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number | null;
    findingsCount: number;
    grounding: string;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
    /** Where `costUsd` came from ('api' = provider-billed, 'estimate' = price table). */
    costSource?: 'api' | 'estimate' | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
      costSource: values.costSource ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/**
 * Record how memory was selected for a run and which entries (with rank and
 * similarity). The mode is written even when no entry was selected, so a run
 * that pulled nothing still counts in "most-pulled memory" denominators.
 */
export async function setMemorySelection(
  db: Db,
  runId: string,
  mode: 'top_k' | 'fallback',
  entries: { id: string; rank: number; similarity: number | null }[],
): Promise<void> {
  await db.update(t.agentRuns).set({ memoryMode: mode }).where(eq(t.agentRuns.id, runId));
  if (entries.length === 0) return;
  await db
    .insert(t.agentRunMemory)
    .values(
      entries.map((e) => ({ runId, memoryId: e.id, rank: e.rank, similarity: e.similarity })),
    )
    .onConflictDoNothing();
}

/** One row per skill that was loaded into the run's prompt. */
export async function insertRunSkills(
  db: Db,
  runId: string,
  records: { skillId: string; skillVersion: number; applied: boolean; findingsCited: number }[],
): Promise<void> {
  if (records.length === 0) return;
  await db
    .insert(t.agentRunSkills)
    .values(records.map((r) => ({ runId, ...r })))
    .onConflictDoNothing();
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(db: Db, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? (row.trace as RunTrace) : undefined;
}
