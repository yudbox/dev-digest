/**
 * Pure LCS (longest common subsequence) line-diff utility — no React, no
 * fetch. Produces a unified-diff-formatted string consumable by the EXISTING
 * `parsePatch()` (`client/src/components/diff-viewer/helpers.ts`), which is
 * itself rendered via `<CodeLine>`. Matches `parsePatch`'s exact expected
 * shape: a `@@ -oldStart,oldCount +newStart,newCount @@` hunk header (see
 * `HUNK_HEADER_RE` in `diff-viewer/constants.ts`) followed by `+`/`-`/` `
 * (space = context) prefixed lines.
 */

export type DiffOpType = "equal" | "add" | "del";

export interface DiffOp {
  type: DiffOpType;
  text: string;
}

/**
 * Classic O(n*m) LCS line diff. Prompts are typically small enough (tens to
 * low hundreds of lines) that the DP table is cheap; this is not intended
 * for diffing arbitrarily large files.
 */
export function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "equal", text: oldLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", text: oldLines[i]! });
      i++;
    } else {
      ops.push({ type: "add", text: newLines[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "del", text: oldLines[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", text: newLines[j]! });
    j++;
  }
  return ops;
}

/**
 * Builds a single-hunk unified-diff patch string for two full prompt texts,
 * formatted exactly as `parsePatch()` expects (GitHub-style +/- diff).
 */
export function buildPromptDiffPatch(
  oldPrompt: string,
  newPrompt: string,
): string {
  const oldLines = oldPrompt.split("\n");
  const newLines = newPrompt.split("\n");
  const ops = diffLines(oldLines, newLines);
  const header = `@@ -1,${oldLines.length} +1,${newLines.length} @@`;
  const body = ops.map((op) => {
    if (op.type === "del") return `-${op.text}`;
    if (op.type === "add") return `+${op.text}`;
    return ` ${op.text}`;
  });
  return [header, ...body].join("\n");
}
