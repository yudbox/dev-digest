/* diff-viewer/findings.ts — pure indexing of smart-diff's `line_findings`
 * into per-file / per-line lookups for the diff viewers. Single source of
 * truth: the client never re-filters or re-derives latest-per-agent /
 * dismissed logic — it only re-shapes what the server already returned
 * (SPEC-2026-09-23-smart-diff-hw3-upgrade, AC-31). */
import type { FindingRecord, SmartDiff } from "@devdigest/shared";
import type { VcsUrlRepo } from "@/lib/utils/vcsUrls";

/** What CodeLine/FileCard/UnanchoredFindings need to render + act on findings
 *  inline. Mirrors the shape of `DiffCommentApi`. */
export interface DiffFindingsApi {
  prId: string;
  /** file path → every non-dismissed finding of that file, as returned
   *  (no filtering, no per-line reduction). */
  byFile: Map<string, FindingRecord[]>;
  repo?: VcsUrlRepo | null;
  headSha?: string | null;
  /** Inline finding annotations (row tint, markers, cards, "outside the diff"
   *  block) follow the same Show/Hide switch as GitHub comments. `false` =
   *  hidden; the file dot, severity chips and group counter stay visible.
   *  Omitted = shown. */
  showInline?: boolean;
  /** Called when a severity chip is clicked while annotations are hidden, so
   *  the jump target is actually visible. */
  onRevealInline?: () => void;
}

/** Flatten every group's files into one file-path → FindingRecord[] map.
 *  Files whose `line_findings` is `null` (no review has run) are absent from
 *  the map entirely — callers must treat "no entry" the same as "no review". */
export function indexLineFindings(smartDiff: SmartDiff): Map<string, FindingRecord[]> {
  const byFile = new Map<string, FindingRecord[]>();
  for (const group of smartDiff.groups) {
    for (const file of group.files) {
      if (file.line_findings !== null) {
        byFile.set(file.path, file.line_findings);
      }
    }
  }
  return byFile;
}

/** A finding is "active" while it hasn't been accepted. Dismissed findings
 *  never reach the client (the server already excludes them). */
export function isActive(f: FindingRecord): boolean {
  return !f.accepted_at;
}

/** Does this file/line have at least one active (not accepted) finding? */
export function hasActive(findings: FindingRecord[] | undefined | null): boolean {
  return !!findings?.some(isActive);
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/** Stable sort: most severe first, then by id (deterministic tie-break). */
function bySeverityThenId(a: FindingRecord, b: FindingRecord): number {
  const rankDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
  if (rankDiff !== 0) return rankDiff;
  return a.id.localeCompare(b.id);
}

/** The most severe ACTIVE finding in the list, or `null` if there are none
 *  (e.g. only accepted findings, or an empty list). Used for the file dot's
 *  colour (AC-17). */
export function mostSevereActive(findings: FindingRecord[]): FindingRecord | null {
  const active = findings.filter(isActive);
  if (active.length === 0) return null;
  return [...active].sort(bySeverityThenId)[0]!;
}

/**
 * Split a file's findings into those anchored to a rendered new-side line
 * (AC-30 — markers only ever attach to a line with a new-file line number)
 * and those that aren't (AC-29 — end-of-file block), e.g. because the
 * finding's `start_line` was on a deleted line, or fell outside a truncated
 * patch, or the file has no patch at all (`renderedNewLines` empty).
 */
export function splitByRenderedLines(
  findings: FindingRecord[],
  renderedNewLines: Set<number>,
): { byLine: Map<number, FindingRecord[]>; unanchored: FindingRecord[] } {
  const byLine = new Map<number, FindingRecord[]>();
  const unanchored: FindingRecord[] = [];
  for (const f of findings) {
    if (renderedNewLines.has(f.start_line)) {
      const list = byLine.get(f.start_line) ?? [];
      list.push(f);
      byLine.set(f.start_line, list);
    } else {
      unanchored.push(f);
    }
  }
  for (const list of byLine.values()) list.sort(bySeverityThenId);
  unanchored.sort((a, b) => a.start_line - b.start_line || bySeverityThenId(a, b));
  return { byLine, unanchored };
}
