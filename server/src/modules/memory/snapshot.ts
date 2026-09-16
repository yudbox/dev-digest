/**
 * Memory snapshot serializer — pure, no I/O.
 *
 * Serializes memory rows to JSONL for `.devdigest/memory.jsonl`.
 * Each line has exactly 5 fields: content, kind, scope, confidence, source.
 * NO embedding. Empty array → empty string.
 *
 * TASK-006 / AC-7/AC-8/R7/R8.
 */
import type { Container } from "../../platform/container.js";
import type { SnapshotMemoryRow } from "./repository.js";

/**
 * Serialize snapshot rows to JSONL. Returns "" when rows is empty.
 */
export function memoryJsonl(rows: SnapshotMemoryRow[]): string {
  if (rows.length === 0) return "";
  return rows
    .map((r) =>
      JSON.stringify({
        content: r.content,
        kind: r.kind,
        scope: r.scope,
        confidence: r.confidence,
        source: r.source,
      }),
    )
    .join("\n");
}

/**
 * Build the memory snapshot string for a CI export.
 * Selects top-50 qualifying rows ordered by confidence × recency.
 */
export async function buildMemorySnapshot(
  container: Container,
  workspaceId: string,
  repoId: string,
): Promise<string> {
  const rows = await container.memoryRepo.selectForSnapshot(
    workspaceId,
    repoId,
  );
  return memoryJsonl(rows);
}
