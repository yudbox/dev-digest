import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import type { SkillRow } from "../../db/rows.js";
import type { ThreatLevel } from "./scanner.js";
export type { SkillRow };

/**
 * A1 — skills data-access. Owns `skills`, `skill_versions` tables.
 * Workspace-scoped throughout.
 */

export interface InsertSkill {
  workspaceId: string;
  /** Skills are workspace-level, not repo-scoped (see schema comment) — omit
   * unless a future feature actually ties a skill to one repo. */
  repoId?: string;
  name: string;
  description: string;
  type: string;
  source: string;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
  threatLevel?: ThreatLevel;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: string;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
  contextDocPaths?: string[];
}

/** A skill with the number of agents it is currently attached to. */
export interface SkillWithAgentCount {
  skill: SkillRow;
  agent_count: number;
}

export interface SkillVersionRow {
  skillId: string;
  version: number;
  body: string;
  createdAt: Date;
}

const INITIAL_SKILL_VERSION = 1;

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));
  }

  /**
   * agent_count per skill for a workspace, in one query. Extracted out of
   * `listWithAgentCounts` so it can be reused/tested independently — mirrors
   * `AgentsRepository.skillCountsForWorkspace()`'s naming.
   */
  async agentCountsForWorkspace(
    workspaceId: string,
    skillIds: string[],
  ): Promise<Map<string, number>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        n: count(t.agentSkills.agentId),
      })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.skillId, skillIds))
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, r.n]));
  }

  /**
   * List skills with the batched `agent_count` (agents each skill is attached
   * to), in a fixed small number of queries — not one per skill. The run-based
   * numbers (pull frequency, accept rate) are NOT computed here: they come from
   * the shared performance aggregation so the list and the Skill Stats tab use
   * one definition.
   */
  async listWithAgentCounts(workspaceId: string): Promise<SkillWithAgentCount[]> {
    const rows = await this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));

    if (rows.length === 0) return [];

    const countMap = await this.agentCountsForWorkspace(
      workspaceId,
      rows.map((r) => r.id),
    );
    return rows.map((skill) => ({ skill, agent_count: countMap.get(skill.id) ?? 0 }));
  }

  async getById(
    workspaceId: string,
    id: string,
  ): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill AND snapshot version 1 into skill_versions. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId ?? null,
        name: values.name,
        description: values.description,
        type: values.type as "rubric" | "convention" | "security" | "custom",
        source: values.source as
          | "manual"
          | "imported_url"
          | "extracted"
          | "community",
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        ...(values.evidenceFiles !== undefined
          ? { evidenceFiles: values.evidenceFiles }
          : {}),
        ...(values.threatLevel !== undefined
          ? { threatLevel: values.threatLevel }
          : {}),
      })
      .returning();
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. Only changing `body` bumps version and snapshots skill_versions.
   * Changing name/description/enabled/type does NOT bump version.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged =
      patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.type !== undefined
          ? {
              type: patch.type as
                | "rubric"
                | "convention"
                | "security"
                | "custom",
            }
          : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined
          ? { evidenceFiles: patch.evidenceFiles }
          : {}),
        ...(patch.contextDocPaths !== undefined
          ? { contextDocPaths: patch.contextDocPaths }
          : {}),
        // Body change resets threat level — a re-scan will run asynchronously.
        ...(bodyChanged
          ? { version: nextVersion, threatLevel: "unknown" as const }
          : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row)
      await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    const rows = await this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
    return rows.map((r) => ({
      skillId: r.skillId,
      version: r.version,
      body: r.body,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Restore a skill's body from a historical version. Loads body from skill_versions
   * where version=N, then updates the skill (bumps version, snapshots).
   */
  async restore(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const [versionRow] = await this.db
      .select()
      .from(t.skillVersions)
      .where(
        and(
          eq(t.skillVersions.skillId, id),
          eq(t.skillVersions.version, version),
        ),
      );

    if (!versionRow) return undefined;

    return this.update(workspaceId, id, { body: versionRow.body });
  }

  private async snapshotVersion(
    skillId: string,
    version: number,
    body: string,
  ): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  async updateThreatLevel(id: string, threatLevel: ThreatLevel): Promise<void> {
    await this.db
      .update(t.skills)
      .set({ threatLevel })
      .where(eq(t.skills.id, id));
  }
}
