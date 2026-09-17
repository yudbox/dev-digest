import { and, eq } from 'drizzle-orm';
import type { VcsProvider } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — repos data-access layer. The ONLY place that touches the `repos`
 * table. Every query is scoped by `workspaceId` (tenancy guard).
 */

export type RepoRow = typeof t.repos.$inferSelect;

export interface InsertRepo {
  workspaceId: string;
  vcsProvider: VcsProvider;
  owner: string;
  name: string;
  /** Azure DevOps only — middle segment of org/project/repo. */
  project?: string;
  /** Azure DevOps only — hosting base URL. */
  baseUrl?: string;
  fullName: string;
  createdBy: string;
}

export class RepoRepository {
  constructor(private db: Db) {}

  /**
   * Find a repo in a workspace by `(vcsProvider, fullName)` (dedupe on add).
   * Provider is part of the lookup key — `github:acme/api` and
   * `azure-devops:acme/api` are different repos and must not collide.
   */
  async findByFullName(
    workspaceId: string,
    vcsProvider: VcsProvider,
    fullName: string,
  ): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(
        and(
          eq(t.repos.workspaceId, workspaceId),
          eq(t.repos.vcsProvider, vcsProvider),
          eq(t.repos.fullName, fullName),
        ),
      );
    return row;
  }

  async list(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }

  async insert(values: InsertRepo): Promise<RepoRow> {
    const [row] = await this.db
      .insert(t.repos)
      .values({
        workspaceId: values.workspaceId,
        vcsProvider: values.vcsProvider,
        owner: values.owner,
        name: values.name,
        project: values.project,
        baseUrl: values.baseUrl,
        fullName: values.fullName,
        createdBy: values.createdBy,
      })
      .returning();
    return row!;
  }

  /**
   * Look up the workspace owning a repo (by repo id, no tenancy scope —
   * the JobRunner's `runCloneJob` is the only caller and it already trusted
   * the payload that came out of an authenticated `add()`). Returns null
   * if the repo was deleted before the followup ran.
   */
  async workspaceIdFor(repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row?.workspaceId ?? null;
  }

  /** Persist the clone path and bump `last_polled_at` once a clone job completes. */
  async updateClonePath(repoId: string, clonePath: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ clonePath, lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)))
      .returning({ id: t.repos.id });
    return deleted.length > 0;
  }
}
