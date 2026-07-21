/**
 * MemoryRepository — the ONLY file in this module touching Drizzle.
 *
 * Owns:
 *   - memory (select/create/update/delete + prompt/snapshot read paths)
 *   - memory_learning_state (watermark get/set)
 *   - Cross-module READ-ONLY join: listNewDismisses (findings → reviews → pulls)
 *
 * TASK-003.
 */
import { and, eq, gte, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import type { MemoryCreateInput, MemoryListQuery } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type MemoryRow = typeof t.memory.$inferSelect;
export type MemoryLearningStateRow = typeof t.memoryLearningState.$inferSelect;

/** Row returned by selectForPrompt — minimal, used to bump lastUsedAt. */
export interface PromptMemoryRow {
  id: string;
  content: string;
}

/** Row returned by selectForSnapshot — exactly the 5 JSONL fields. */
export interface SnapshotMemoryRow {
  content: string;
  kind: string;
  scope: string;
  confidence: number;
  source: string;
}

/** Row returned by listNewDismisses — read-only view of findings. */
export interface DismissedFindingRow {
  findingId: string;
  prNumber: number;
  repoId: string;
  category: string;
  file: string;
  title: string;
  rationale: string;
  dismissedAt: Date;
}

export interface InsertMemory {
  workspaceId: string;
  repoId?: string | null;
  scope: "repo" | "global" | "team";
  kind: "decision" | "convention" | "preference" | "fact" | "learning";
  content: string;
  confidence: number;
  source: "explicit" | "auto";
  sources?: unknown;
}

export interface UpdateMemory {
  content?: string;
  kind?: "decision" | "convention" | "preference" | "fact" | "learning";
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class MemoryRepository {
  constructor(private db: Db) {}

  // ---- Read paths ----------------------------------------------------------

  /**
   * Prompt read path (AC-1/R1/R20): scope=global OR (scope=repo AND repo_id=repoId),
   * confidence >= 0.7. Returns id+content only (id needed to bump lastUsedAt).
   */
  async selectForPrompt(
    workspaceId: string,
    repoId: string,
  ): Promise<PromptMemoryRow[]> {
    const rows = await this.db
      .select({ id: t.memory.id, content: t.memory.content })
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, workspaceId),
          gte(t.memory.confidence, 0.7),
          or(
            eq(t.memory.scope, "global"),
            and(eq(t.memory.scope, "repo"), eq(t.memory.repoId, repoId)),
          ),
        ),
      );
    return rows;
  }

  /**
   * Snapshot read path (AC-5/R5/R6/R20): same WHERE as selectForPrompt, but
   * ordered by confidence × recency DESC, capped at 50. Recency = epoch seconds
   * of COALESCE(last_used_at, created_at) normalized to the range [0,1] is
   * impractical in SQL; instead we use the raw epoch value as a tie-breaker via
   * a combined score: confidence * epoch_seconds (big epoch = recent).
   *
   * Formula: confidence * EXTRACT(epoch FROM COALESCE(last_used_at, created_at))
   * This is monotonically increasing with both confidence and recency.
   */
  async selectForSnapshot(
    workspaceId: string,
    repoId: string,
  ): Promise<SnapshotMemoryRow[]> {
    const rows = await this.db
      .select({
        content: t.memory.content,
        kind: t.memory.kind,
        scope: t.memory.scope,
        confidence: t.memory.confidence,
        source: t.memory.source,
      })
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, workspaceId),
          gte(t.memory.confidence, 0.7),
          or(
            eq(t.memory.scope, "global"),
            and(eq(t.memory.scope, "repo"), eq(t.memory.repoId, repoId)),
          ),
        ),
      )
      .orderBy(
        sql`${t.memory.confidence} * EXTRACT(epoch FROM COALESCE(${t.memory.lastUsedAt}, ${t.memory.createdAt})) DESC`,
      )
      .limit(50);
    return rows.map((r) => ({
      content: r.content,
      kind: r.kind,
      scope: r.scope,
      confidence: r.confidence ?? 0,
      source: r.source,
    }));
  }

  /**
   * Bump lastUsedAt for rows that were actually injected into a prompt (AC-3/R3).
   * No-op when ids is empty.
   */
  async touchLastUsed(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(t.memory)
      .set({ lastUsedAt: at })
      .where(inArray(t.memory.id, ids));
  }

  // ---- CRUD ----------------------------------------------------------------

  async create(input: InsertMemory): Promise<MemoryRow> {
    const [row] = await this.db
      .insert(t.memory)
      .values({
        workspaceId: input.workspaceId,
        repoId: input.repoId ?? null,
        scope: input.scope,
        kind: input.kind,
        content: input.content,
        confidence: input.confidence,
        source: input.source,
        sources: (input.sources as object | undefined) ?? null,
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  async get(workspaceId: string, id: string): Promise<MemoryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)));
    return row;
  }

  /**
   * List with server-side filters (scope/kind/source/q ILIKE on content).
   * LEFT JOINs repos so we can build the scopeLabel in the service layer.
   */
  async list(
    workspaceId: string,
    filters: MemoryListQuery,
  ): Promise<
    (MemoryRow & { repoOwner: string | null; repoName: string | null })[]
  > {
    const conditions = [eq(t.memory.workspaceId, workspaceId)];

    if (filters.scope) {
      conditions.push(eq(t.memory.scope, filters.scope));
    }
    if (filters.kind) {
      conditions.push(eq(t.memory.kind, filters.kind));
    }
    if (filters.source) {
      conditions.push(eq(t.memory.source, filters.source));
    }
    if (filters.q) {
      conditions.push(ilike(t.memory.content, `%${filters.q}%`));
    }

    const rows = await this.db
      .select({
        id: t.memory.id,
        workspaceId: t.memory.workspaceId,
        repoId: t.memory.repoId,
        scope: t.memory.scope,
        kind: t.memory.kind,
        content: t.memory.content,
        embedding: t.memory.embedding,
        confidence: t.memory.confidence,
        source: t.memory.source,
        sources: t.memory.sources,
        createdAt: t.memory.createdAt,
        updatedAt: t.memory.updatedAt,
        lastUsedAt: t.memory.lastUsedAt,
        repoOwner: t.repos.owner,
        repoName: t.repos.name,
      })
      .from(t.memory)
      .leftJoin(t.repos, eq(t.memory.repoId, t.repos.id))
      .where(and(...conditions))
      .orderBy(sql`${t.memory.createdAt} DESC`);

    return rows as (MemoryRow & {
      repoOwner: string | null;
      repoName: string | null;
    })[];
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateMemory,
  ): Promise<MemoryRow | undefined> {
    const [row] = await this.db
      .update(t.memory)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.confidence !== undefined
          ? { confidence: patch.confidence }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)))
      .returning();
    return row;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)))
      .returning({ id: t.memory.id });
    return result.length > 0;
  }

  /** Insert an auto-distilled row (source='auto'). */
  async insertAuto(values: {
    workspaceId: string;
    repoId: string;
    scope: "repo" | "global" | "team";
    kind: "decision" | "convention" | "preference" | "fact" | "learning";
    content: string;
    confidence: number;
    sources: unknown;
  }): Promise<MemoryRow> {
    const [row] = await this.db
      .insert(t.memory)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId,
        scope: values.scope,
        kind: values.kind,
        content: values.content,
        confidence: values.confidence,
        source: "auto",
        sources: values.sources as object,
        updatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  // ---- Cross-module read-only dismiss reader (AC-19/R19/R22) --------------

  /**
   * Returns dismissed findings newer than `since` (or all when null), ordered
   * by dismissedAt ASC. Joins findings → reviews → pull_requests to build a
   * flat row. NEVER writes to the reviews tables.
   */
  async listNewDismisses(
    workspaceId: string,
    since: Date | null,
  ): Promise<DismissedFindingRow[]> {
    const conditions = [
      eq(t.reviews.workspaceId, workspaceId),
      sql`${t.findings.dismissedAt} IS NOT NULL`,
    ];
    if (since) {
      conditions.push(gt(t.findings.dismissedAt, since));
    }

    const rows = await this.db
      .select({
        findingId: t.findings.id,
        prNumber: t.pullRequests.number,
        repoId: t.pullRequests.repoId,
        category: t.findings.category,
        file: t.findings.file,
        title: t.findings.title,
        rationale: t.findings.rationale,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .where(and(...conditions))
      .orderBy(sql`${t.findings.dismissedAt} ASC`);

    return rows.map((r) => ({
      findingId: r.findingId,
      prNumber: r.prNumber,
      repoId: r.repoId,
      category: r.category,
      file: r.file,
      title: r.title,
      rationale: r.rationale,
      dismissedAt: r.dismissedAt!,
    }));
  }

  // ---- Watermark (memory_learning_state) -----------------------------------

  async getWatermark(workspaceId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ lastProcessedAt: t.memoryLearningState.lastProcessedAt })
      .from(t.memoryLearningState)
      .where(eq(t.memoryLearningState.workspaceId, workspaceId));
    return row?.lastProcessedAt ?? null;
  }

  async setWatermark(workspaceId: string, at: Date): Promise<void> {
    await this.db
      .insert(t.memoryLearningState)
      .values({
        workspaceId,
        lastProcessedAt: at,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: t.memoryLearningState.workspaceId,
        set: {
          lastProcessedAt: at,
          updatedAt: new Date(),
        },
      });
  }
}
