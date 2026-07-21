/**
 * MemoryService — application layer for the Memory module.
 *
 * Handles:
 *  - Explicit CRUD (create/list/get/update/delete)
 *  - refresh() → list + trigger runLearning()
 *  - runLearning() — background auto-distillation from dismissed findings
 *
 * TASK-005.
 */
import type { Container } from "../../platform/container.js";
import {
  type MemoryCreateInput,
  type MemoryListQuery,
  type MemoryItemDto,
  type MemoryUpdateInput,
  type MemoryRefreshResult,
} from "@devdigest/shared";
import { ValidationError, NotFoundError } from "../../platform/errors.js";
import { resolveFeatureModelStrict } from "../settings/feature-models.js";
import type { MemoryRepository } from "./repository.js";
import { autoConfidence } from "./learning/confidence.js";
import { groupDismisses } from "./learning/group.js";
import { distillDismisses } from "./learning/distill.js";

const DISTILL_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// DTO builder
// ---------------------------------------------------------------------------

function toDto(
  row: Awaited<ReturnType<MemoryRepository["list"]>>[number],
): MemoryItemDto {
  let scopeLabel: string;
  if (row.scope === "repo" && row.repoOwner && row.repoName) {
    scopeLabel = `repo · ${row.repoOwner}/${row.repoName}`;
  } else {
    scopeLabel = row.scope;
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    repoId: row.repoId ?? null,
    scopeLabel,
    scope: row.scope as MemoryItemDto["scope"],
    kind: row.kind as MemoryItemDto["kind"],
    content: row.content,
    confidence: row.confidence ?? 0,
    source: row.source as MemoryItemDto["source"],
    sources: row.sources ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MemoryService {
  private repo: MemoryRepository;

  constructor(private container: Container) {
    this.repo = container.memoryRepo;
  }

  // ---- Explicit CRUD -------------------------------------------------------

  async create(
    workspaceId: string,
    input: MemoryCreateInput,
  ): Promise<MemoryItemDto> {
    const content = input.content.trim();
    if (!content) {
      throw new ValidationError("content must not be empty");
    }
    if (input.scope === "repo" && !input.repoId) {
      throw new ValidationError("repoId is required when scope is 'repo'");
    }

    const row = await this.repo.create({
      workspaceId,
      repoId: input.scope === "repo" ? input.repoId : null,
      scope: input.scope,
      kind: input.kind,
      content,
      confidence: 0.9,
      source: "explicit",
    });

    // Re-fetch with join for scopeLabel
    const rows = await this.repo.list(workspaceId, {});
    const full = rows.find((r) => r.id === row.id);
    return toDto(full ?? { ...row, repoOwner: null, repoName: null });
  }

  async list(
    workspaceId: string,
    filters: MemoryListQuery,
  ): Promise<MemoryItemDto[]> {
    const rows = await this.repo.list(workspaceId, filters);
    return rows.map(toDto);
  }

  async get(
    workspaceId: string,
    id: string,
  ): Promise<MemoryItemDto | undefined> {
    const rows = await this.repo.list(workspaceId, {});
    const row = rows.find((r) => r.id === id);
    return row ? toDto(row) : undefined;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: MemoryUpdateInput,
  ): Promise<MemoryItemDto | undefined> {
    const updated = await this.repo.update(workspaceId, id, {
      content: patch.content,
      kind: patch.kind,
      confidence: patch.confidence,
    });
    if (!updated) return undefined;

    const rows = await this.repo.list(workspaceId, {});
    const full = rows.find((r) => r.id === id);
    return full ? toDto(full) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.delete(workspaceId, id);
  }

  // ---- Refresh + learning -------------------------------------------------

  /**
   * On-demand refresh: reads local DB + triggers runLearning.
   * Returns fresh list and count of newly learned rows.
   */
  async refresh(workspaceId: string): Promise<MemoryRefreshResult> {
    const { learned, scanned } = await this.runLearning(workspaceId);
    return { learned, scanned };
  }

  /**
   * Learning loop: scan new dismissals since watermark → group → distill → insertAuto.
   * Per-group try/catch isolates failures (AC-18/R18).
   */
  async runLearning(
    workspaceId: string,
  ): Promise<{ learned: number; scanned: number }> {
    const since = await this.repo.getWatermark(workspaceId);
    const dismisses = await this.repo.listNewDismisses(workspaceId, since);

    if (dismisses.length === 0) {
      return { learned: 0, scanned: 0 };
    }

    const groups = groupDismisses(dismisses);
    const qualified = groups.filter(
      (g) => g.dismisses.length >= DISTILL_THRESHOLD,
    );

    let learned = 0;
    let maxDismissedAt = since ?? new Date(0);

    for (const group of qualified) {
      try {
        // Resolve model (throws ValidationError if not configured — isolated to this group)
        const { provider, model } = await resolveFeatureModelStrict(
          this.container,
          workspaceId,
          "memory_distill",
        );
        const llm = await this.container.llm(provider);

        const content = await distillDismisses(llm, model, group.dismisses);
        const confidence = autoConfidence(group.dismisses.length);
        const sources = {
          findingIds: group.dismisses.map((d) => d.findingId),
          prNumbers: [...new Set(group.dismisses.map((d) => d.prNumber))],
        };

        await this.repo.insertAuto({
          workspaceId,
          repoId: group.repoId,
          scope: "repo",
          kind: "learning",
          content,
          confidence,
          sources,
        });

        learned++;
      } catch {
        // Isolated failure — continue with next group
      }

      if (group.maxDismissedAt > maxDismissedAt) {
        maxDismissedAt = group.maxDismissedAt;
      }
    }

    // Advance watermark over ALL scanned dismissals (not just qualified groups)
    const allMax = dismisses.reduce(
      (m, d) => (d.dismissedAt > m ? d.dismissedAt : m),
      maxDismissedAt,
    );
    await this.repo.setWatermark(workspaceId, allMax);

    return { learned, scanned: dismisses.length };
  }
}
