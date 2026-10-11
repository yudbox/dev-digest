import type {
  Agent,
  CiFailOn,
  Provider,
  ReviewStrategy,
} from "@devdigest/shared";
import type { AgentRow } from "./repository.js";
import { EMPTY_AGGREGATE, toAgentRow, type AgentAggregate } from "../performance/helpers.js";

/**
 * Pure helpers for the agents module — DB row ⇄ DTO mapping and the
 * config-version-bump rule. No I/O; behaviour-identical to the previous inline
 * implementations.
 */

/** Map a persisted agent row to the public `Agent` DTO. */
export function toAgentDto(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider as Provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema ?? null,
    enabled: row.enabled,
    version: row.version,
    strategy: row.strategy as ReviewStrategy,
    ci_fail_on: row.ciFailOn as CiFailOn,
    repo_intel: row.repoIntel,
    feature_model_id: row.featureModelId ?? null,
    context_doc_paths: (row.contextDocPaths as string[]) ?? [],
  };
}

/** Fields whose change bumps the agent's config version (anything but `enabled`). */
export interface ConfigChangePatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  /** Changing attached context doc paths changes agent behaviour → bumps version. */
  contextDocPaths?: string[];
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * existing row — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(
  existing: Pick<
    AgentRow,
    | "name"
    | "description"
    | "provider"
    | "model"
    | "systemPrompt"
    | "strategy"
    | "ciFailOn"
    | "repoIntel"
    | "contextDocPaths"
  >,
  patch: ConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined &&
      patch.description !== existing.description) ||
    (patch.provider !== undefined && patch.provider !== existing.provider) ||
    (patch.model !== undefined && patch.model !== existing.model) ||
    (patch.systemPrompt !== undefined &&
      patch.systemPrompt !== existing.systemPrompt) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy) ||
    (patch.ciFailOn !== undefined && patch.ciFailOn !== existing.ciFailOn) ||
    (patch.repoIntel !== undefined && patch.repoIntel !== existing.repoIntel) ||
    patch.outputSchema !== undefined ||
    (patch.contextDocPaths !== undefined &&
      JSON.stringify(patch.contextDocPaths) !==
        JSON.stringify(existing.contextDocPaths ?? []))
  );
}

/** The list-view stats fields of the public `Agent` DTO. */
export type AgentListStats = Pick<
  Agent,
  "runs_count" | "accept_rate_pct" | "avg_cost_usd" | "avg_duration_ms"
>;

/**
 * All-time list stats from the shared performance aggregation, via the SAME row
 * mapper the dashboard and the Agent Stats tab use (so the numbers cannot
 * drift). `accept_rate_pct` is omitted — not 0 — when nobody has accepted or
 * dismissed a finding yet: "no decisions" is not "0% accepted".
 */
export function toAgentListStats(agg: AgentAggregate | undefined): AgentListStats {
  const row = toAgentRow({ id: null, name: "", enabled: true }, agg ?? EMPTY_AGGREGATE, undefined, []);
  return {
    runs_count: row.runs,
    ...(row.accept.resolved > 0
      ? { accept_rate_pct: Math.round((row.accept.accepted / row.accept.resolved) * 100) }
      : {}),
    avg_cost_usd: row.avgCostUsd,
    avg_duration_ms: row.avgDurationMs,
  };
}
