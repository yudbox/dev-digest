import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load memory rules from `.devdigest/memory.jsonl`.
 *
 * - File missing → []
 * - Empty file → []
 * - Malformed line → skip and continue (never throw)
 * - Each valid line must be JSON with a `content` string field
 *
 * AC-9/R9. Mirrors loadSkillBodies but is forgiving (missing file is normal).
 */
export function loadMemory(
  devdigestDir: string,
  readFile: typeof readFileSync = readFileSync,
): string[] {
  const memoryPath = path.join(devdigestDir, "memory.jsonl");

  let raw: string;
  try {
    raw = readFile(memoryPath, "utf8") as unknown as string;
  } catch {
    // File missing or unreadable — zero memory rows is normal
    return [];
  }

  const results: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "content" in parsed &&
        typeof (parsed as Record<string, unknown>).content === "string"
      ) {
        results.push((parsed as Record<string, unknown>).content as string);
      }
    } catch {
      // Malformed line — skip and continue
    }
  }

  return results;
}
