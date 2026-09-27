import type { DevDigestClient } from "../api-client.js";
import { mcpSuccess } from "../api-client.js";

// Local interface mirrors BlastRadiusResult from
// server/src/vendor/shared/contracts/brief.ts → BlastRadiusResult
// (@devdigest/shared alias not available in standalone mcp/ package)
interface BlastRadiusResult {
  changedSymbols: Array<{ file: string; name: string; kind: string }>;
  callers: Array<{
    file: string;
    symbol: string;
    viaSymbol: string;
    line: number;
    rank: number;
  }>;
  impactedEndpoints: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: string;
  priorPrs?: Array<{
    id: string;
    number: number;
    title: string;
    openedAt: string | null;
    status: string;
  }>;
  summary?: string;
}

export async function getBlastRadius(
  client: DevDigestClient,
  args: { pr_id: string },
) {
  const result = await client.request<BlastRadiusResult>(
    "GET",
    `/pulls/${args.pr_id}/blast`,
  );
  if (!result.ok) return result.result;

  // Pass the route response through unchanged — the browser card and the
  // agent see the exact same map (criterion: no extra computation here).
  return mcpSuccess(result.data);
}
