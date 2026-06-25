/** Pure classifier — no DB, no I/O, no imports from drizzle.
 *  Maps file paths to SmartDiffRole and builds the base SmartDiff shape. */

import type { SmartDiff, SmartDiffRole } from "@devdigest/shared";
import {
  BOILERPLATE_PATTERNS,
  WIRING_PATTERNS,
  TOO_BIG_THRESHOLD,
} from "./classifier-patterns.js";

/** SmartDiff without review_tokens (filled in by PullsService after DB lookup). */
export type SmartDiffBase = Omit<SmartDiff, "review_tokens">;

export interface ClassifiableFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Classify a single file path into a SmartDiffRole. */
export function classifyFile(path: string): SmartDiffRole {
  for (const re of BOILERPLATE_PATTERNS) {
    if (re.test(path)) return "boilerplate";
  }
  for (const re of WIRING_PATTERNS) {
    if (re.test(path)) return "wiring";
  }
  return "core";
}

const ROLE_ORDER: SmartDiffRole[] = ["core", "wiring", "boilerplate"];

/** Group files by role and produce a SmartDiffBase (no tokens, no finding data). */
export function buildSmartDiff(files: ClassifiableFile[]): SmartDiffBase {
  const byRole = new Map<SmartDiffRole, ClassifiableFile[]>([
    ["core", []],
    ["wiring", []],
    ["boilerplate", []],
  ]);

  for (const f of files) {
    byRole.get(classifyFile(f.path))!.push(f);
  }

  const totalLines = files.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );

  const groups = ROLE_ORDER.filter((role) => byRole.get(role)!.length > 0).map(
    (role) => ({
      role,
      files: byRole.get(role)!.map((f) => ({
        path: f.path,
        pseudocode_summary: null,
        additions: f.additions,
        deletions: f.deletions,
        finding_lines: [] as number[],
        severity_counts: null,
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
