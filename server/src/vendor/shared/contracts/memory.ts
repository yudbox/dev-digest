import { z } from "zod";

/**
 * Memory subsystem — API contracts.
 *
 * TASK-001: New file. Shared between server and client (mirrored verbatim).
 *
 * Design rules:
 *  - scope='repo' requires repoId (enforced by superRefine in MemoryCreateInput).
 *  - scope='global'|'team' → repoId is stripped/null.
 *  - source: 'explicit' = user-added; 'auto' = distilled from dismissed findings.
 *  - confidence: explicit rows default 0.9; auto rows use autoConfidence(count).
 */

// ---------------------------------------------------------------------------
// Enums (MemoryScope + MemoryKind are re-exported from knowledge.ts)
// ---------------------------------------------------------------------------

import { MemoryScope, MemoryKind } from "./knowledge.js";
export { MemoryScope, MemoryKind };

export const MemorySourceKind = z.enum(["explicit", "auto"]);
export type MemorySourceKind = z.infer<typeof MemorySourceKind>;

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

/** Full row DTO returned by list/get/create/update. */
export const MemoryItemDto = z.object({
  id: z.string(),
  workspaceId: z.string(),
  repoId: z.string().nullable(),
  /** For display in the SCOPE column: "global", "team", or "repo · owner/name". */
  scopeLabel: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  content: z.string(),
  confidence: z.number().min(0).max(1),
  /** 'explicit' | 'auto' */
  source: MemorySourceKind,
  /** Provenance for auto rows: { findingIds?, prNumbers? }. Null for explicit. */
  sources: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type MemoryItemDto = z.infer<typeof MemoryItemDto>;

/** Create payload (POST /memory). */
export const MemoryCreateInput = z
  .object({
    content: z.string().min(1, "content is required"),
    kind: MemoryKind,
    scope: MemoryScope,
    repoId: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === "repo" && !val.repoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoId"],
        message: "repoId is required when scope is 'repo'",
      });
    }
  });
export type MemoryCreateInput = z.infer<typeof MemoryCreateInput>;

/** Partial update payload (PATCH /memory/:id). */
export const MemoryUpdateInput = z.object({
  content: z.string().min(1).optional(),
  kind: MemoryKind.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInput>;

/** Query string for GET /memory (server-side filters). */
export const MemoryListQuery = z.object({
  scope: MemoryScope.optional(),
  kind: MemoryKind.optional(),
  source: MemorySourceKind.optional(),
  q: z.string().optional(),
});
export type MemoryListQuery = z.infer<typeof MemoryListQuery>;

/** Response for GET /memory. */
export const MemoryListResponse = z.object({
  items: z.array(MemoryItemDto),
});
export type MemoryListResponse = z.infer<typeof MemoryListResponse>;

/** Response for POST /memory/refresh. */
export const MemoryRefreshResult = z.object({
  learned: z.number().int(),
  scanned: z.number().int(),
});
export type MemoryRefreshResult = z.infer<typeof MemoryRefreshResult>;

// ---------------------------------------------------------------------------
// Snapshot record (used by CI export — no embedding, no internal IDs)
// ---------------------------------------------------------------------------

/** One line in `.devdigest/memory.jsonl`. Exactly 5 fields, no embedding. */
export const MemorySnapshotRecord = z.object({
  content: z.string(),
  kind: MemoryKind,
  scope: MemoryScope,
  confidence: z.number().min(0).max(1),
  source: MemorySourceKind,
});
export type MemorySnapshotRecord = z.infer<typeof MemorySnapshotRecord>;
