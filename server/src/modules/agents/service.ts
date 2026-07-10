import { eq } from "drizzle-orm";
import type { Container } from "../../platform/container.js";
import type {
  Agent,
  AgentSkillLink,
  AgentVersionSummary,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
  FeatureModelId,
} from "@devdigest/shared";
import * as t from "../../db/schema.js";
import { AgentsRepository } from "./repository.js";
import { toAgentDto } from "./helpers.js";

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from "./helpers.js";

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
  feature_model_id?: FeatureModelId | null;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
  feature_model_id?: FeatureModelId | null;
  context_doc_paths?: string[];
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    // Attach skill_count + bonus stats to each agent (two extra queries for
    // ALL agents combined — never one query per agent).
    const skillCounts = await this.repo.skillCountsForWorkspace(workspaceId);
    const stats = await this.repo.statsForWorkspace(workspaceId);
    return rows.map((row) => {
      const s = stats.get(row.id);
      return {
        ...toAgentDto(row),
        skill_count: skillCounts.get(row.id) ?? 0,
        runs_count: s?.runsCount ?? 0,
        accept_rate_pct: s?.acceptRatePct ?? 0,
        avg_cost_usd: s?.avgCostUsd ?? null,
      };
    });
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const skillCount = await this.repo.skillCount(id);
    const stats = await this.repo.statsForWorkspace(workspaceId);
    const s = stats.get(id);
    return {
      ...toAgentDto(row),
      skill_count: skillCount,
      runs_count: s?.runsCount ?? 0,
      accept_rate_pct: s?.acceptRatePct ?? 0,
      avg_cost_usd: s?.avgCostUsd ?? null,
    };
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(
    workspaceId: string,
    input: CreateAgentInput,
    userId?: string,
  ): Promise<Agent> {
    const [repo] = await this.container.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId))
      .limit(1);
    const row = await this.repo.insert({
      workspaceId,
      repoId: repo?.id,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined
        ? { repoIntel: input.repo_intel }
        : {}),
      ...(input.feature_model_id !== undefined
        ? { featureModelId: input.feature_model_id }
        : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined
        ? { systemPrompt: patch.system_prompt }
        : {}),
      ...(patch.output_schema !== undefined
        ? { outputSchema: patch.output_schema }
        : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined
        ? { repoIntel: patch.repo_intel }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.feature_model_id !== undefined
        ? { featureModelId: patch.feature_model_id }
        : {}),
      ...(patch.context_doc_paths !== undefined
        ? { contextDocPaths: patch.context_doc_paths }
        : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({
      agent_id: agentId,
      skill_id: l.skill.id,
      order: l.order,
    }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Version history for an agent (newest first) — mirrors `SkillsService.versions()`.
   * Guard: ensure the agent belongs to the workspace before exposing versions;
   * returns `[]` (not a 404) when the agent isn't found, same as skills.
   */
  async listVersions(
    workspaceId: string,
    id: string,
  ): Promise<AgentVersionSummary[]> {
    const agent = await this.repo.getById(workspaceId, id);
    if (!agent) return [];
    const rows = await this.repo.listVersions(id);
    return rows.map((r) => ({
      version: r.version,
      system_prompt: r.systemPrompt,
      created_at: r.createdAt.toISOString(),
    }));
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
