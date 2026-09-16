/**
 * Pure helper functions for the aggregate endpoint.
 * No imports from Fastify, Drizzle, LLM adapters, or platform — only
 * contracts and node:crypto (I/O-free crypto hash).
 */
import { createHash } from 'node:crypto';
import type { MultiAgentRun, AggregatedSource, AggregatedFinding } from '@devdigest/shared';
import { AGGREGATE_LINE_GAP } from './constants.js';

// ---------------------------------------------------------------------------
// Severity ranking (CRITICAL > WARNING > SUGGESTION)
// ---------------------------------------------------------------------------

const SEV_RANK: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

// ---------------------------------------------------------------------------
// collectSourceFindings — AC-14 / R13
// ---------------------------------------------------------------------------

/**
 * Flatten all findings from columns whose status is "done".
 * Columns with status "failed" or "running" are excluded.
 */
export function collectSourceFindings(run: MultiAgentRun): AggregatedSource[] {
  const sources: AggregatedSource[] = [];
  for (const col of run.columns) {
    if (col.status !== 'done') continue;
    for (const f of col.findings) {
      sources.push({
        finding_id: f.id,
        review_id: f.review_id,
        run_id: col.run_id,
        agent_id: col.agent_id,
        agent_name: col.agent_name,
        severity: f.severity,
        file: f.file,
        start_line: f.start_line,
      });
    }
  }
  return sources;
}

// ---------------------------------------------------------------------------
// preGroupFindings — AC-15 / R14
// ---------------------------------------------------------------------------

/**
 * Group findings into candidate clusters for LLM-based deduplication.
 * Two findings are candidates if they are in the SAME FILE and their line
 * ranges overlap or their nearest boundaries are within `gap` lines.
 *
 * Findings from different files are never combined.
 * Returns a list of groups (each group is a list of AggregatedSource items).
 */
export function preGroupFindings(
  sources: AggregatedSource[],
  gap = AGGREGATE_LINE_GAP,
): AggregatedSource[][] {
  if (sources.length === 0) return [];

  // Group by file first.
  const byFile = new Map<string, AggregatedSource[]>();
  for (const s of sources) {
    const arr = byFile.get(s.file);
    if (arr) {
      arr.push(s);
    } else {
      byFile.set(s.file, [s]);
    }
  }

  const result: AggregatedSource[][] = [];

  for (const fileSources of byFile.values()) {
    // Sort by start_line for greedy interval merging.
    const sorted = [...fileSources].sort((a, b) => a.start_line - b.start_line);

    // We use the corresponding AgentColumnFinding's end_line if available,
    // but AggregatedSource only carries start_line. Use start_line as both
    // endpoints for overlap/gap detection (conservative grouping).
    const groups: AggregatedSource[][] = [];
    let current: AggregatedSource[] = [sorted[0]!];
    let currentMax = sorted[0]!.start_line;

    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i]!;
      const distance = s.start_line - currentMax;
      if (distance <= gap) {
        // Within the gap threshold — same candidate group.
        current.push(s);
        if (s.start_line > currentMax) currentMax = s.start_line;
      } else {
        groups.push(current);
        current = [s];
        currentMax = s.start_line;
      }
    }
    groups.push(current);
    result.push(...groups);
  }

  return result;
}

// ---------------------------------------------------------------------------
// reconcileSeverity — AC-17 / R16
// ---------------------------------------------------------------------------

/**
 * Compute the reconciled severity and category for a group of sources.
 * - severity = maximum among all sources (CRITICAL > WARNING > SUGGESTION)
 * - category = the category of the source with the highest severity;
 *   on a tie, the first source (in original order) wins.
 *
 * NOTE: AggregatedSource does not carry `category` — the caller must supply
 * the original FindingRecord's category alongside each source via the
 * `categoryMap` parameter (finding_id → category).
 */
export function reconcileSeverity(
  sources: AggregatedSource[],
  categoryMap: Map<string, string>,
): { severity: AggregatedSource['severity']; category: string } {
  let bestRank = -1;
  let bestSeverity: AggregatedSource['severity'] = 'SUGGESTION';
  let bestCategory = 'bug';

  for (const s of sources) {
    const rank = SEV_RANK[s.severity] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      bestSeverity = s.severity;
      bestCategory = categoryMap.get(s.finding_id) ?? 'bug';
    }
  }

  return { severity: bestSeverity, category: bestCategory };
}

// ---------------------------------------------------------------------------
// groupId — AC-20 / R19
// ---------------------------------------------------------------------------

/**
 * Deterministic id for an aggregated finding: SHA-256 of the sorted,
 * comma-joined finding_ids, hex-encoded, first 16 characters.
 */
export function groupId(findingIds: string[]): string {
  const sorted = [...findingIds].sort().join(',');
  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// groundGroups — AC-19 / R18
// ---------------------------------------------------------------------------

/**
 * Shape returned by the LLM for a single group, before grounding.
 * The service validates this with LlmAggregateGroupSchema.safeParse first.
 */
export interface LlmGroup {
  finding_ids: string[];
  title: string;
  reviewer_comment: string;
}

/**
 * Ground LLM-returned groups against the known source set:
 *   - unknown finding_ids are dropped;
 *   - a finding_id already claimed by an earlier group is dropped;
 *   - sources from a DIFFERENT file than the group's first source are dropped;
 *   - groups with no remaining sources after filtering are dropped.
 *
 * The caller must also supply a categoryMap and a findingDetails map
 * (finding_id → { end_line, category }) for building the full AggregatedFinding.
 */
export function groundGroups(
  llmGroups: LlmGroup[],
  sources: AggregatedSource[],
  findingDetails: Map<string, { end_line: number; category: string }>,
): AggregatedFinding[] {
  const sourceMap = new Map<string, AggregatedSource>(
    sources.map((s) => [s.finding_id, s]),
  );
  const used = new Set<string>();
  const results: AggregatedFinding[] = [];

  for (const group of llmGroups) {
    // Resolve and filter sources for this group.
    const resolved: AggregatedSource[] = [];
    for (const fid of group.finding_ids) {
      if (!sourceMap.has(fid)) continue; // unknown id
      if (used.has(fid)) continue;       // already claimed
      resolved.push(sourceMap.get(fid)!);
    }

    if (resolved.length === 0) continue;

    // All sources must belong to the same file as the first source.
    const primaryFile = resolved[0]!.file;
    const sameFile = resolved.filter((s) => s.file === primaryFile);
    if (sameFile.length === 0) continue;

    // Mark ids as used.
    for (const s of sameFile) used.add(s.finding_id);

    const categoryMap = new Map(
      sameFile.map((s) => [s.finding_id, findingDetails.get(s.finding_id)?.category ?? 'bug']),
    );
    const { severity, category } = reconcileSeverity(sameFile, categoryMap);
    const start_line = Math.min(...sameFile.map((s) => s.start_line));
    const end_line = Math.max(...sameFile.map((s) => findingDetails.get(s.finding_id)?.end_line ?? s.start_line));
    const id = groupId(sameFile.map((s) => s.finding_id));

    results.push({
      id,
      severity,
      category,
      file: primaryFile,
      start_line,
      end_line,
      title: group.title,
      reviewer_comment: group.reviewer_comment,
      sources: sameFile,
    });
  }

  return results;
}
