import type { DevDigestClient } from "../api-client.js";
import { mcpError, mcpSuccess } from "../api-client.js";

/**
 * Mirrors ReviewDto from server/src/modules/reviews/helpers.ts.
 * Update here if the API response shape changes.
 */
interface ReviewRow {
  id: string;
  agent_id: string | null;
  run_id: string | null;
  agent_name: string | null;
  model: string | null;
  verdict: string | null;
  summary: string | null;
  score: number | null;
  created_at: string;
  findings: Array<{
    severity: string;
    category: string;
    title: string;
    file: string;
    start_line: number;
    rationale: string;
    suggestion?: string | null;
  }>;
}

function deduplicateByAgent(reviews: ReviewRow[]): ReviewRow[] {
  const latest = new Map<string, ReviewRow>();
  const nullAgentReviews: ReviewRow[] = [];

  for (const r of reviews) {
    if (r.agent_id === null) {
      nullAgentReviews.push(r);
      continue;
    }
    const existing = latest.get(r.agent_id);
    if (!existing || r.created_at > existing.created_at) {
      latest.set(r.agent_id, r);
    }
  }

  return [...latest.values(), ...nullAgentReviews];
}

export async function getFindings(
  client: DevDigestClient,
  args: { pr_id: string; all_runs?: boolean },
) {
  const { pr_id, all_runs = false } = args;

  const result = await client.request<ReviewRow[]>(
    "GET",
    `/pulls/${pr_id}/reviews`,
  );

  if (!result.ok) {
    return mcpError(
      `PR '${pr_id}' not found. Check the pr_id or import PRs via the DevDigest UI.`,
    );
  }

  if (result.data.length === 0) {
    return mcpError(
      `No reviews found for PR '${pr_id}'. Run a review first with run_agent_on_pr.`,
    );
  }

  const reviews = all_runs ? result.data : deduplicateByAgent(result.data);

  const nested = reviews.map((r) => ({
    review_id: r.id,
    agent_id: r.agent_id,
    agent_name: r.agent_name ?? null,
    run_id: r.run_id ?? null,
    verdict: r.verdict,
    summary: r.summary,
    score: r.score,
    model: r.model ?? null,
    created_at: r.created_at,
    findings: r.findings.map((f) => ({
      severity: f.severity,
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      rationale: f.rationale,
      suggestion: f.suggestion ?? null,
    })),
  }));

  const total_findings = nested.reduce((sum, r) => sum + r.findings.length, 0);

  return mcpSuccess({ reviews: nested, total_findings });
}
