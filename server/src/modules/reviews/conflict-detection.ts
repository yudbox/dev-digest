import { rangesOverlap } from "@devdigest/reviewer-core";
import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

function jaccardOverlap(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface FindingLike {
  file: string;
  start_line: number;
  title: string;
  severity: string;
}

/** True when two findings overlap at the same location AND have similar titles. */
export function isSameLocation(a: FindingLike, b: FindingLike): boolean {
  if (a.file !== b.file) return false;
  if (!rangesOverlap(a.start_line, a.start_line, b.start_line, b.start_line))
    return false;
  return jaccardOverlap(a.title, b.title) >= 0.3;
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/**
 * Compute conflicts from a set of agent columns.
 *
 * showOnlyTrueConflicts=false (default): any location where ≥1 agent flagged
 *   AND ≥1 other running agent did NOT, or agents assigned divergent severities.
 * showOnlyTrueConflicts=true: only locations where 2+ agents each produced
 *   their own finding AND their severity/verdict differs.
 */
export function computeConflicts(
  columns: AgentColumn[],
  showOnlyTrueConflicts: boolean,
): Conflict[] {
  type Tagged = {
    finding: AgentColumn["findings"][number];
    agentId: string;
    agentName: string;
  };

  const all: Tagged[] = [];
  for (const col of columns) {
    for (const f of col.findings) {
      all.push({
        finding: f,
        agentId: col.agent_id,
        agentName: col.agent_name,
      });
    }
  }

  // Greedy clustering by isSameLocation
  const clusters: Tagged[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    const cluster: Tagged[] = [all[i]!];
    used.add(i);
    for (let j = i + 1; j < all.length; j++) {
      if (used.has(j)) continue;
      if (isSameLocation(all[i]!.finding, all[j]!.finding)) {
        cluster.push(all[j]!);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }

  const conflicts: Conflict[] = [];

  for (const cluster of clusters) {
    const flaggerIds = new Set(cluster.map((c) => c.agentId));
    const nonFlaggers = columns.filter((c) => !flaggerIds.has(c.agent_id));
    const severities = new Set(cluster.map((c) => c.finding.severity));
    const hasDivergentSeverity = severities.size > 1;
    const isContention = nonFlaggers.length > 0 || hasDivergentSeverity;
    if (!isContention) continue;

    if (showOnlyTrueConflicts) {
      if (flaggerIds.size < 2 || !hasDivergentSeverity) continue;
    }

    const rep = cluster.reduce((best, curr) =>
      (SEVERITY_RANK[curr.finding.severity] ?? 0) >
      (SEVERITY_RANK[best.finding.severity] ?? 0)
        ? curr
        : best,
    );

    const takes: ConflictTake[] = [
      ...cluster.map((c) => ({
        agent_id: c.agentId,
        persona: c.agentName,
        verdict: c.finding.severity as ConflictTake["verdict"],
        note: c.finding.title,
      })),
      ...nonFlaggers.map((c) => ({
        agent_id: c.agent_id,
        persona: c.agent_name,
        verdict: "ignored" as const,
        note: "did not flag",
      })),
    ];

    conflicts.push({
      file: rep.finding.file,
      line: rep.finding.start_line,
      title: rep.finding.title,
      takes,
    });
  }

  return conflicts;
}
