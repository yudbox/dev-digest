import { and, asc, avg, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import type { CiFailOn, Provider, ReviewStrategy } from "@devdigest/shared";
import {
  DEFAULT_AGENT_DESCRIPTION,
  INITIAL_AGENT_VERSION,
} from "./constants.js";
import { isConfigChange } from "./helpers.js";

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow } from "../../db/rows.js";
export type { AgentRow };

export interface InsertAgent {
  workspaceId: string;
  /** Optional because the pre-existing service layer does not always supply
   * repo_id — the DB column is NOT NULL (migration 0015) but existing inserts
   * predate that constraint. The integration tests work around this directly. */
  repoId?: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  contextDocPaths?: string[];
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

/** One `agent_versions` row, with `system_prompt` extracted from `config_json`. */
export interface AgentVersionRow {
  version: number;
  systemPrompt: string;
  createdAt: Date;
}

/** Bonus list-stats (AC-30): runs count, finding-level accept rate, avg cost. */
export interface AgentStats {
  runsCount: number;
  acceptRatePct: number;
  avgCostUsd: number | null;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(
        and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)),
      );
  }

  async getById(
    workspaceId: string,
    id: string,
  ): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        // repoId is NOT NULL at the DB level (migration 0015) but
        // pre-existing call-sites don't always supply it — non-null assertion
        // preserves existing behaviour without runtime change.
        repoId: values.repoId!,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined
          ? { repoIntel: values.repoIntel }
          : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined
          ? { systemPrompt: patch.systemPrompt }
          : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined
          ? { repoIntel: patch.repoIntel }
          : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.contextDocPaths !== undefined
          ? { contextDocPaths: patch.contextDocPaths }
          : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  /**
   * Version history for an agent, newest first — mirrors
   * `SkillsRepository.listVersions()` (Q9). `system_prompt` is read back out of
   * the immutable `config_json` snapshot (the only place the historical prompt
   * text survives; `agents.system_prompt` only holds the CURRENT value).
   */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    const rows = await this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
    return rows.map((r) => ({
      version: r.version,
      systemPrompt:
        (r.configJson as { system_prompt?: string }).system_prompt ?? "",
      createdAt: r.createdAt,
    }));
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(
    agentId: string,
    skillId: string,
    order: number,
  ): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.agentSkills.skillId, skillId),
        ),
      );
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await this.db
      .insert(t.agentSkills)
      .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
  }

  /** Number of skills linked to a single agent. */
  async skillCount(agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count(t.agentSkills.skillId) })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agentId));
    return row?.n ?? 0;
  }

  /**
   * Map of agentId → skill count for all agents in a workspace.
   * Used by AgentsService.list() to attach skill_count without N+1 queries.
   */
  async skillCountsForWorkspace(
    workspaceId: string,
  ): Promise<Map<string, number>> {
    const agents = await this.list(workspaceId);
    if (agents.length === 0) return new Map();
    const agentIds = agents.map((a) => a.id);
    const rows = await this.db
      .select({
        agentId: t.agentSkills.agentId,
        n: count(t.agentSkills.skillId),
      })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.agentId, agentIds))
      .groupBy(t.agentSkills.agentId);
    return new Map(rows.map((r) => [r.agentId, r.n]));
  }

  /**
   * Map of agentId → {runsCount, acceptRatePct, avgCostUsd} for every agent in
   * a workspace, in ONE query (two pre-aggregated subqueries LEFT JOINed onto
   * `agents` — not a per-agent loop). `accept_rate_pct` is FINDING-level (%
   * of resolved findings — accepted OR dismissed — that were accepted), not
   * verdict-level (AC-30's explicit clarification; deliberately different from
   * `SkillsRepository`'s existing verdict-based formula, reused as-is for
   * AC-31 — the two bonus stats are intentionally NOT the same formula).
   */
  async statsForWorkspace(
    workspaceId: string,
  ): Promise<Map<string, AgentStats>> {
    const runsAgg = this.db
      .select({
        agentId: t.agentRuns.agentId,
        runsCount: count(t.agentRuns.id).as("runs_count"),
        avgCost: avg(t.agentRuns.costUsd).as("avg_cost"),
      })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.workspaceId, workspaceId))
      .groupBy(t.agentRuns.agentId)
      .as("runs_agg");

    const findingsAgg = this.db
      .select({
        agentId: t.reviews.agentId,
        resolved: count(
          sql`CASE WHEN ${t.findings.acceptedAt} IS NOT NULL OR ${t.findings.dismissedAt} IS NOT NULL THEN 1 END`,
        ).as("resolved"),
        accepted: count(
          sql`CASE WHEN ${t.findings.acceptedAt} IS NOT NULL THEN 1 END`,
        ).as("accepted"),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.reviews.workspaceId, workspaceId))
      .groupBy(t.reviews.agentId)
      .as("findings_agg");

    const rows = await this.db
      .select({
        agentId: t.agents.id,
        runsCount: runsAgg.runsCount,
        avgCost: runsAgg.avgCost,
        resolved: findingsAgg.resolved,
        accepted: findingsAgg.accepted,
      })
      .from(t.agents)
      .leftJoin(runsAgg, eq(runsAgg.agentId, t.agents.id))
      .leftJoin(findingsAgg, eq(findingsAgg.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));

    const result = new Map<string, AgentStats>();
    for (const row of rows) {
      const resolved = row.resolved ?? 0;
      const accepted = row.accepted ?? 0;
      result.set(row.agentId, {
        runsCount: row.runsCount ?? 0,
        acceptRatePct:
          resolved > 0 ? Math.round((accepted / resolved) * 100) : 0,
        avgCostUsd: row.avgCost == null ? null : Number(row.avgCost),
      });
    }
    return result;
  }
}
