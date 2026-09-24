/** Pure classifier — no DB, no I/O, no imports from drizzle.
 *  Maps file paths to SmartDiffRole and builds the base SmartDiff shape. */

import type { SmartDiff, SmartDiffRole } from "@devdigest/shared";
import {
  ROLE_PATTERNS,
  ROLE_CHECK_ORDER,
  DEFAULT_ROLE,
  ROLE_DISPLAY_ORDER,
  TOO_BIG_THRESHOLD,
} from "./classifier-patterns.js";

/** SmartDiff without review_tokens (filled in by PullsService after DB lookup). */
export type SmartDiffBase = Omit<SmartDiff, "review_tokens">;

export interface ClassifiableFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Classify a single file path into a SmartDiffRole: the first role in
 *  `ROLE_CHECK_ORDER` whose patterns match, else `DEFAULT_ROLE`. All roles,
 *  patterns and orders live in `classifier-patterns.ts`.
 *  Pure/deterministic: same path always yields the same role, no I/O. */
export function classifyFile(path: string): SmartDiffRole {
  for (const role of ROLE_CHECK_ORDER) {
    if (ROLE_PATTERNS[role].some((re) => re.test(path))) return role;
  }
  return DEFAULT_ROLE;
}

/** Group files by role and produce a SmartDiffBase (no tokens, no finding data). */
export function buildSmartDiff(files: ClassifiableFile[]): SmartDiffBase {
  const byRole = new Map<SmartDiffRole, ClassifiableFile[]>(
    ROLE_DISPLAY_ORDER.map((role) => [role, []]),
  );

  for (const f of files) {
    byRole.get(classifyFile(f.path))!.push(f);
  }

  const totalLines = files.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );

  // All five groups, always, in display order — an empty group is still
  // returned (files: []) so the UI can show its role label with "0 files".
  const groups = ROLE_DISPLAY_ORDER.map(
    (role) => ({
      role,
      files: byRole.get(role)!.map((f) => ({
        path: f.path,
        pseudocode_summary: null,
        additions: f.additions,
        deletions: f.deletions,
        line_findings: null as null,
      })),
    }),
  );

  return {
    groups,
    split_suggestion: {
      too_big: totalLines > TOO_BIG_THRESHOLD,
      total_lines: totalLines,
      proposed_splits: [],
    },
  };
}
