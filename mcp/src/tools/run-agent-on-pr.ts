import type { DevDigestClient } from "../api-client.js";
import { mcpError, mcpSuccess } from "../api-client.js";

interface RunSummary {
  run_id: string;
  agent_id: string | null;
  status: string | null;
  error?: string | null;
}

interface FindingCompact {
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  rationale: string;
  suggestion: string | null;
}

interface ReviewRow {
  id: string;
  agent_id: string | null;
  run_id: string | null;
  verdict: string | null;
  summary: string | null;
  score: number | null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAgentOnPr(
  client: DevDigestClient,
  args: { pr_id: string; agent_id: string },
) {
  const { pr_id, agent_id } = args;

  // Pre-validate agent exists before POST (avoids guessing by error text)
  const agentCheck = await client.request<unknown>(
    "GET",
    `/agents/${agent_id}`,
  );
  if (!agentCheck.ok) {
    return mcpError(
      `Agent '${agent_id}' not found. Call list_agents to get valid IDs.`,
    );
  }

  // Step 1: POST /pulls/:pr_id/review { agentId }
  const startResult = await client.request<{ runs: Array<{ run_id: string }> }>(
    "POST",
    `/pulls/${pr_id}/review`,
    { agentId: agent_id },
  );

  if (!startResult.ok) {
    // Agent was pre-validated above; any 404 here is the PR not found
    return mcpError(
      `PR '${pr_id}' not found. Check the pr_id or import PRs via the DevDigest UI.`,
    );
  }

  const runId = startResult.data.runs[0]?.run_id;
  if (!runId) {
    return mcpError(
      `Review started but no run_id returned. Check DevDigest UI for details.`,
    );
  }

  // Step 2: Poll GET /runs/:run_id/trace (plan: trace.stats present = done)
  // Trace is only written on completion; fallback to /pulls/:pr_id/runs to
  // detect failures (failed runs never produce a trace).
  const deadline = Date.now() + client.config.pollTimeoutMs;
  let traceData: unknown = null;

  while (Date.now() < deadline) {
    await sleep(client.config.pollIntervalMs);

    const traceResult = await client.request<unknown>(
      "GET",
      `/runs/${runId}/trace`,
    );

    if (traceResult.ok) {
      // trace.stats present means the run completed successfully
      traceData = traceResult.data;
      break;
    }

    // 404 = trace not yet written (still running OR failed).
    // Check run status to detect failure early.
    const runsResult = await client.request<RunSummary[]>(
      "GET",
      `/pulls/${pr_id}/runs`,
    );
    if (runsResult.ok) {
      const run = runsResult.data.find((r) => r.run_id === runId);
      if (run?.status === "failed" || run?.status === "cancelled") {
        return mcpError(
          `Review run failed with status '${run.status}'. Check DevDigest UI for details.`,
        );
      }
    }
  }

  if (!traceData) {
    return mcpError(
      `Run timed out after ${client.config.pollTimeoutMs / 1000}s. Check run status later via get_findings with pr_id='${pr_id}'.`,
    );
  }

  // Step 3: GET /pulls/:pr_id/reviews and find the matching review
  const reviewsResult = await client.request<ReviewRow[]>(
    "GET",
    `/pulls/${pr_id}/reviews`,
  );
  if (!reviewsResult.ok) return reviewsResult.result;

  const review = reviewsResult.data.find((r) => r.run_id === runId);
  if (!review) {
    return mcpError(
      `Run completed but no review found. Check DevDigest UI for details.`,
    );
  }

  const findings: FindingCompact[] = review.findings.map((f) => ({
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
  }));

  return mcpSuccess({
    verdict: review.verdict,
    summary: review.summary,
    score: review.score,
    findings,
  });
}
