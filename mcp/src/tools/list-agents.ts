import type { DevDigestClient } from "../api-client.js";
import { mcpSuccess } from "../api-client.js";

interface AgentRow {
  id: string;
  name: string;
  description?: string | null;
  model?: string | null;
  provider?: string | null;
  enabled?: boolean | null;
  [key: string]: unknown;
}

export async function listAgents(client: DevDigestClient) {
  const result = await client.request<AgentRow[]>("GET", "/agents");
  if (!result.ok) return result.result;

  const agents = result.data.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description ?? "",
    model: a.model ?? "",
    enabled: a.enabled ?? false,
  }));

  return mcpSuccess({ agents });
}
