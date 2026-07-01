import type { DevDigestClient } from "../api-client.js";
import { mcpError, mcpSuccess } from "../api-client.js";

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

  const { data } = result;
  const cronSet = new Set<string>();
  if (data.factsByFile) {
    for (const facts of Object.values(data.factsByFile)) {
      facts.crons.forEach((c) => cronSet.add(c));
    }
  }

  return mcpSuccess({
    pr_id: args.pr_id,
    summary:
      data.summary ??
      `${data.changedSymbols.length} symbols, ${data.callers.length} callers, ${data.impactedEndpoints.length} endpoints, ${cronSet.size} crons`,
    degraded: data.degraded ?? false,
    reason: data.reason ?? null,
    changedSymbols: data.changedSymbols,
    callers: data.callers,
    impactedEndpoints: data.impactedEndpoints,
    crons: [...cronSet],
    priorPrs: data.priorPrs ?? [],
  });
}
