/**
 * Prompt construction for the aggregate endpoint.
 * No imports from Fastify, Drizzle, or platform DI.
 * Only Zod (for schemas) and the platform/prompt shim (for wrapUntrusted).
 */
import { z } from 'zod';
import { wrapUntrusted } from '../../platform/prompt.js';
import type { AggregatedSource } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Zod schemas for LLM I/O
// ---------------------------------------------------------------------------

/**
 * STRICT per-element schema used by the service to validate each element
 * returned by the LLM (soft-schema mode: applied element-by-element).
 */
export const LlmAggregateGroupSchema = z.object({
  finding_ids: z.array(z.string()).min(1),
  title: z.string().min(1),
  reviewer_comment: z.string().min(1),
});
export type LlmAggregateGroup = z.infer<typeof LlmAggregateGroupSchema>;

/**
 * SOFT schema sent to the LLM provider so a single malformed group cannot
 * fail the entire batch. Strict validation is done per-element in the service.
 */
export const LlmAggregateResponseSchema = z.object({
  groups: z.array(z.unknown()),
});

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const AGGREGATE_SYSTEM_PROMPT = `\
You are an expert code-review assistant. Your task is to semantically deduplicate
a list of code-review findings and produce a consolidated list.

## Rules

1. ONE ROOT CAUSE IN ONE PLACE = ONE ROW.
   If several findings describe the same underlying problem at the same location
   in the code, merge them into a single group.

2. DIFFERENT ROOT CAUSE = SEPARATE ROWS.
   If findings in the same area of code describe fundamentally different issues,
   keep them as separate rows even if they overlap in line numbers.

3. WORDING DIFFERENCES DO NOT JUSTIFY SPLITTING.
   Two findings that say the same thing in different words must be merged.

4. CROSS-FILE MERGING IS FORBIDDEN.
   Never put findings from different files into the same group.

5. Each group must reference at least one finding_id from the input.
   Do NOT invent finding_ids or carry over ids not present in the input.

6. severity and category are computed server-side — do NOT include them in your output.

## reviewer_comment format

Write the reviewer_comment field in TWO parts, separated by the literal string
"\n\n---\n\n" (a blank line, three dashes, a blank line):
  - FIRST: an English-language comment ready to paste into a pull request.
  - SECOND: a Russian-language summary of the same comment.

## Output format

Return ONLY valid JSON, no markdown fences, no explanation, no trailing comma.

### JSON schema

{
  "groups": [
    {
      "finding_ids": ["uuid1", "uuid2"],
      "title": "Short human-readable title of the issue",
      "reviewer_comment": "EN text ready for the PR\n\n---\n\nRU текст для ревьюера"
    }
  ]
}

### One-shot example

Input findings (2 groups):
  Group A — candidates in the same file/area (possible duplicates):
    [finding_id=aaa, file=src/auth.ts, line=42]
    title: "Missing auth check on /admin route"
    rationale: "The /admin endpoint has no authentication middleware."

    [finding_id=bbb, file=src/auth.ts, line=45]
    title: "Admin route not protected"
    rationale: "Unauthenticated users can access /admin."

  Group B — single finding:
    [finding_id=ccc, file=src/db.ts, line=10]
    title: "SQL injection risk"
    rationale: "User input is concatenated directly into the query."

Expected output:
{
  "groups": [
    {
      "finding_ids": ["aaa", "bbb"],
      "title": "Missing authentication on /admin route",
      "reviewer_comment": "The /admin route is not protected by authentication middleware. Any unauthenticated user can access it. Please add the auth middleware to this route.\n\n---\n\nМаршрут /admin не защищён middleware аутентификации. Любой неаутентифицированный пользователь получает к нему доступ. Необходимо добавить middleware аутентификации."
    },
    {
      "finding_ids": ["ccc"],
      "title": "SQL injection risk",
      "reviewer_comment": "User-supplied input is concatenated directly into the SQL query string, creating an SQL injection vulnerability. Use parameterised queries or a query builder instead.\n\n---\n\nПользовательский ввод конкатенируется напрямую в строку SQL-запроса, что создаёт уязвимость SQL-инъекции. Используйте параметризованные запросы или query builder."
    }
  ]
}
`;

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

interface FindingText {
  finding_id: string;
  file: string;
  start_line: number;
  title: string;
  rationale: string;
  suggestion: string;
}

/**
 * Build the user-turn prompt.
 *
 * - Groups are presented as "candidate duplicate clusters" (findings sharing
 *   the same file and nearby line ranges).
 * - Each finding's title/rationale/suggestion is wrapped in wrapUntrusted()
 *   because these texts derive from the diff/PR (untrusted, AC-27).
 * - Metadata (finding_id, file, line) is trusted (server-produced) and NOT wrapped.
 */
export function buildAggregateUserPrompt(
  groups: AggregatedSource[][],
  texts: Map<string, FindingText>,
): string {
  const lines: string[] = ['Here are the code-review findings to deduplicate:\n'];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    const label =
      group.length > 1
        ? `Group ${gi + 1} — possible duplicates (same file / nearby lines):`
        : `Group ${gi + 1} — single finding:`;
    lines.push(label);

    for (const src of group) {
      const ft = texts.get(src.finding_id);
      if (!ft) continue;

      lines.push(`  [finding_id=${src.finding_id}, file=${ft.file}, line=${ft.start_line}]`);
      lines.push(`  title: ${wrapUntrusted('title', ft.title)}`);
      lines.push(`  rationale: ${wrapUntrusted('rationale', ft.rationale)}`);
      if (ft.suggestion) {
        lines.push(`  suggestion: ${wrapUntrusted('suggestion', ft.suggestion)}`);
      }
      lines.push('');
    }
  }

  lines.push('Return the consolidated JSON array now.');
  return lines.join('\n');
}
