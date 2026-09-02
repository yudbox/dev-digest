/**
 * TASK-007 (R28) — split a raw unified diff (as produced by `git diff`, i.e.
 * `UnifiedDiff.raw`) into per-file patches, matching the shape GitHub's REST
 * API returns per file (`PrFile.patch`): each patch starts at the first `@@`
 * hunk header and contains NO `diff --git`/`---`/`+++` header lines. Keeping
 * this shape means no client render code (`SmartDiffViewer`, `FindingCard`)
 * needs to change for Azure DevOps.
 *
 * Reuses `parseUnifiedDiff` conceptually (same header-line recognition) but
 * is intentionally a separate, minimal function — `parseUnifiedDiff` builds
 * `DiffHunk[]` with line-number bookkeeping for the grounding gate; this only
 * needs to bucket raw text lines by file.
 */
export function splitUnifiedDiffByFile(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = raw.split("\n");
  // A diff ending in '\n' produces a trailing '' element from split('\n') —
  // must be dropped, or the last hunk's coverage is inflated by one line
  // (agent-runner/insights/INSIGHTS.md:26).
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let currentPath: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentPath && buffer.length > 0) {
      const body = buffer.join("\n");
      const existing = result.get(currentPath);
      result.set(currentPath, existing ? `${existing}\n${body}` : body);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flush();
      currentPath = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/^b\//, "").trim();
      if (p !== "/dev/null") currentPath = p;
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (currentPath === null) continue; // header noise before the first +++ line (mode/index/rename lines)
    buffer.push(line);
  }
  flush();

  return result;
}
