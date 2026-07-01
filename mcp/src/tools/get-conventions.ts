import type { DevDigestClient } from "../api-client.js";
import { mcpError, mcpSuccess } from "../api-client.js";

interface ConventionRow {
  id: string;
  rule: string;
  confidence: number;
  accepted: boolean | null;
  [key: string]: unknown;
}

export async function getConventions(
  client: DevDigestClient,
  args: { repo_id: string },
) {
  const { repo_id } = args;

  const result = await client.request<ConventionRow[]>(
    "GET",
    `/repos/${repo_id}/conventions`,
  );

  if (!result.ok) {
    return mcpError(`Repository '${repo_id}' not found. Check the repo_id.`);
  }

  const conventions = result.data
    .filter((c) => c.accepted === true)
    .map((c) => ({
      rule: c.rule,
      confidence: c.confidence,
    }));

  return mcpSuccess({ conventions });
}
