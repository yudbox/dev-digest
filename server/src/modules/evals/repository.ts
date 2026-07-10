import { and, count, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalOwnerKind } from '@devdigest/shared';

/**
 * A6 — evals data-access. Owns `eval_cases` + `eval_runs`. The ONLY file in
 * this module touching Drizzle. Workspace-scoping is enforced by joining
 * through `eval_cases.workspace_id` (eval_runs has no workspace_id column).
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  ownerKind?: EvalOwnerKind;
  ownerId?: string;
  name?: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  ranAt: Date;
  actualOutput: unknown;
  pass: boolean;
  recall: number;
  precision: number;
  /** Null for rubric-type skill cases — citation accuracy is specific to the
   *  `groundFindings` pass (kept/dropped around a diff), which the rubric
   *  strategy never runs (no diff to ground). The `citation_accuracy` DB
   *  column is already nullable (`doublePrecision('citation_accuracy')`,
   *  no `.notNull()`). */
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
  batchId: string;
  /** Snapshot of the agent's version at run time; null for skill-owned cases. */
  agentVersion: number | null;
}

/** One `eval_runs` row joined with its case's name + expected_output (for
 *  dashboard aggregation / alert phrasing) + owner id (for workspace-wide
 *  cross-agent aggregation). */
export interface EvalRunJoinedRow {
  run: EvalRunRow;
  caseName: string;
  caseExpectedOutput: unknown;
  ownerId: string;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  // ---- eval_cases ---------------------------------------------------------

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? '',
        inputFiles: (values.inputFiles as object | undefined) ?? null,
        inputMeta: (values.inputMeta as object | undefined) ?? null,
        expectedOutput: values.expectedOutput as object,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /** List cases for a workspace, optionally scoped to one owner. */
  async listCases(
    workspaceId: string,
    ownerKind?: EvalOwnerKind,
    ownerId?: string,
  ): Promise<EvalCaseRow[]> {
    const conditions = [eq(t.evalCases.workspaceId, workspaceId)];
    if (ownerKind) conditions.push(eq(t.evalCases.ownerKind, ownerKind));
    if (ownerId) conditions.push(eq(t.evalCases.ownerId, ownerId));
    return this.db
      .select()
      .from(t.evalCases)
      .where(and(...conditions));
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.ownerKind !== undefined ? { ownerKind: patch.ownerKind } : {}),
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined
          ? { inputFiles: patch.inputFiles as object }
          : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** Map of ownerId → case count, for a given owner kind, in one query
   *  (used by `POST /eval-runs/all`'s "agents with eval_cases.count > 0" filter
   *  and by the dashboard's `cases_total` fields — batched, no N+1). */
  async casesCountByOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId, n: count(t.evalCases.id) })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, ownerKind)))
      .groupBy(t.evalCases.ownerId);
    return new Map(rows.map((r) => [r.ownerId, r.n]));
  }

  // ---- eval_runs ------------------------------------------------------------

  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        ranAt: values.ranAt,
        actualOutput: values.actualOutput as object,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        batchId: values.batchId,
        agentVersion: values.agentVersion,
      })
      .returning();
    return row!;
  }

  /**
   * All eval_runs for the given owner KIND in a workspace, most recent first,
   * joined with the case's name + expected_output. Pass `ownerId` to scope to
   * ONE owner (single dashboard); omit it to get every owner of that kind in
   * the workspace in ONE query (the workspace-wide landing overview) — the
   * caller groups by `ownerId` in memory, avoiding a per-owner query loop.
   */
  async runsForOwnerKind(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId?: string,
  ): Promise<EvalRunJoinedRow[]> {
    const conditions = [
      eq(t.evalCases.workspaceId, workspaceId),
      eq(t.evalCases.ownerKind, ownerKind),
    ];
    if (ownerId) conditions.push(eq(t.evalCases.ownerId, ownerId));
    return this.db
      .select({
        run: t.evalRuns,
        caseName: t.evalCases.name,
        caseExpectedOutput: t.evalCases.expectedOutput,
        ownerId: t.evalCases.ownerId,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(...conditions))
      .orderBy(desc(t.evalRuns.ranAt));
  }
}
