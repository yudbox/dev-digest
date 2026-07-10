/**
 * Pure helpers for the eval-case "Code" tab (manually-written finding-grounded
 * skill cases — `convention`/`security`/`custom`). No React, no fetch.
 *
 * The Code tab hides raw diff syntax from the author: they type a "Before"
 * and/or "After" snippet and this module builds the unified-diff string that
 * is actually persisted as `input_diff`. All manually-written skill cases
 * share ONE hidden file path so the author never has to think about it.
 *
 * `SNIPPET_FILE_PATH` MUST stay equal to the backend's
 * `MANUAL_SKILL_CASE_FILE_PATH` (`server/src/modules/evals/constants.ts`) —
 * `parseExpectedOutput` injects that same literal as the `file` key on
 * skeleton findings that omit it, and scoring matches `expected.file ===
 * actual.file`. Kept in sync manually (not imported cross-package), same
 * discipline as the `eval-ci.ts` contract mirror.
 */
import { diffLines } from "@/lib/diff/lcs-diff";

export const SNIPPET_FILE_PATH = "snippet.ts";

/**
 * Builds a unified diff for the hidden snippet file from separate
 * "before"/"after" text blocks, reusing the LCS core from `lcs-diff.ts`.
 * `before === ''` (New-file mode) yields an all-`+` diff — no reimplementation
 * of the diff algorithm here, only formatting.
 */
export function buildSnippetDiff(
  before: string,
  after: string,
  path: string,
): string {
  const oldLines = before === "" ? [] : before.split("\n");
  const newLines = after === "" ? [] : after.split("\n");
  const ops = diffLines(oldLines, newLines);
  const body = ops.map((op) => {
    if (op.type === "del") return `-${op.text}`;
    if (op.type === "add") return `+${op.text}`;
    return ` ${op.text}`;
  });
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...body,
  ].join("\n");
}

export interface ParsedSnippet {
  mode: "new" | "modified";
  before: string;
  after: string;
}

/**
 * Best-effort reconstruction of the Before/After textarea contents from a
 * previously generated snippet diff — round-trips exactly for diffs produced
 * by `buildSnippetDiff` above. Used only to prefill `CodeInput` when opening
 * an existing case; never touches the persisted `input_diff` directly.
 */
export function parseSnippetDiff(diff: string): ParsedSnippet {
  if (!diff.trim()) return { mode: "new", before: "", after: "" };

  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  let hasDel = false;

  for (const line of diff.split("\n")) {
    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      afterLines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      beforeLines.push(line.slice(1));
      hasDel = true;
    } else {
      const text = line.startsWith(" ") ? line.slice(1) : line;
      beforeLines.push(text);
      afterLines.push(text);
    }
  }

  return {
    mode: hasDel ? "modified" : "new",
    before: beforeLines.join("\n"),
    after: afterLines.join("\n"),
  };
}
