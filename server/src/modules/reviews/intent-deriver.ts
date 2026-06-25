import type { Container } from "../../platform/container.js";
import type { ReviewRepository, PullRow } from "./repository.js";
import type {
  UnifiedDiff,
  Intent,
  IssueMeta,
  Provider,
} from "@devdigest/shared";
import { Intent as IntentSchema } from "@devdigest/shared";
import { resolveFeatureModel } from "../settings/feature-models.js";
import type { RunLogger } from "../../platform/run-logger.js";

const MAX_BODY_CHARS = 2000;

const INTENT_SYSTEM_PROMPT =
  "You are a PR intent classifier. Given a PR title, optional description, and a list " +
  "of changed files with their hunk positions (no code bodies), output the PR's intent " +
  "summary, what changes are in scope, what is explicitly out of scope, and up to 4 risk areas. " +
  "If there is no description, infer intent from the title and changed file paths — " +
  "this is expected and sufficient. Be concise and specific. " +
  "For risk_areas: each item must have a title (≤6 words) and a kind from: " +
  "'security', 'dependency', 'performance', 'data', 'api_change', 'other'. " +
  'Examples: {"title":"Exposes unauthenticated endpoint","kind":"security"}, ' +
  '{"title":"Adds heavy DB aggregation query","kind":"performance"}. ' +
  "Omit risk_areas entirely if there are no meaningful risks. " +
  "Always respond in English regardless of the language of the PR title, body, or linked issue.";

function formatIntent(data: Intent): string {
  const parts = [
    `Summary: ${data.intent}`,
    `In scope: ${data.in_scope.join("; ")}`,
    `Out of scope: ${data.out_of_scope.join("; ")}`,
  ];
  if (data.risk_areas && data.risk_areas.length > 0) {
    const risks = data.risk_areas
      .map((r) => `${r.title} [${r.kind}]`)
      .join("; ");
    parts.push(`Risk areas: ${risks}`);
  }
  return parts.join("\n");
}

export async function deriveIntent(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  diff: UnifiedDiff,
  runLog: RunLogger,
  linkedIssue?: IssueMeta,
  forceRecalculate?: boolean,
): Promise<string | undefined> {
  try {
    // Step 0 — cache check: skip if headSha hasn't moved (unless forced)
    const cached = await repo.getIntent(pull.id);
    if (!forceRecalculate && cached && pull.lastReviewedSha === pull.headSha) {
      runLog.info("Intent: using cached (headSha unchanged)");
      return formatIntent(cached);
    }

    // Step 1 — resolve cheap model
    const { provider, model } = await resolveFeatureModel(
      container,
      workspaceId,
      "review_intent",
    );

    // Step 2 — get LLM provider (may throw if key not configured)
    let llm;
    try {
      llm = await container.llm(provider as Provider);
    } catch (err) {
      runLog.info(
        `Intent: provider "${provider}" not configured — skipping (${(err as Error).message})`,
      );
      return undefined;
    }

    // Step 3 — build input (hunk headers only, no patch bodies)
    const lines: string[] = [`PR #${pull.number}: ${pull.title}`];
    if (pull.body && pull.body.trim().length > 0) {
      lines.push("", pull.body.slice(0, MAX_BODY_CHARS));
    }
    // Linked issue: title + body give the classifier the original requirement
    if (linkedIssue) {
      lines.push(
        "",
        `Linked issue #${linkedIssue.number}: ${linkedIssue.title}`,
      );
      if (linkedIssue.body && linkedIssue.body.trim().length > 0) {
        lines.push(linkedIssue.body.slice(0, 1000));
      }
    }
    lines.push("", "Changed files:");
    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        // Format hunk header from oldStart/oldLines/newStart/newLines fields
        const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
        lines.push(`${header} ${file.path}`);
      }
    }
    const inputText = lines.join("\n");

    // Step 4 — log token savings
    runLog.info(
      `Intent input: ~${Math.ceil(inputText.length / 4)} est. tokens ` +
        `(vs ~${Math.ceil(diff.raw.length / 4)} for full diff)`,
    );

    // Step 5 — classify
    const result = await llm.completeStructured({
      model,
      schema: IntentSchema,
      schemaName: "Intent",
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: inputText },
      ],
      temperature: 0.2,
      maxTokens: 800,
    });
    // Re-parse to apply transforms (e.g. nullish → []) and get the typed output
    const intentData: Intent = IntentSchema.parse(result.data);

    // Step 6 — persist
    await repo.upsertIntent(pull.id, intentData);

    return formatIntent(intentData);
  } catch (err) {
    runLog.info(
      `Intent derivation failed: ${(err as Error).message} — continuing without intent`,
    );
    return undefined;
  }
}
