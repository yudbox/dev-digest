/**
 * Distill a batch of similar dismissed findings into ONE generalised memory rule.
 *
 * Input: dismissed finding text (title + rationale + category + file).
 * Never receives raw PR content (AC-22/R22).
 *
 * AC-14/R14/R18.
 */
import type { LLMProvider } from "@devdigest/shared";
import type { DismissedFindingRow } from "../repository.js";

const SYSTEM_PROMPT = `You are a code review policy analyst.
You will receive a list of code review findings that a developer dismissed as not applicable.
Your job is to distill them into ONE concise generalised rule that explains why this pattern
should NOT be flagged in this codebase. Output ONLY the rule text, one sentence, starting with
an action verb (e.g. "Ignore", "Allow", "Skip", "Accept").
Do NOT include explanations, bullet points, or any other formatting — just the rule.`;

export async function distillDismisses(
  llm: LLMProvider,
  model: string,
  dismisses: DismissedFindingRow[],
): Promise<string> {
  const lines = dismisses
    .map(
      (d, i) =>
        `${i + 1}. [${d.category}] ${d.file}\n   Title: ${d.title}\n   Rationale: ${d.rationale}`,
    )
    .join("\n\n");

  const userMessage = `Dismissed findings (${dismisses.length}):\n\n${lines}`;

  const result = await llm.complete({
    model,
    maxTokens: 150,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  return result.text.trim();
}
