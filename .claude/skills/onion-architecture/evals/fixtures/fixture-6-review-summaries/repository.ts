import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { pullRequests } from '../../db/schema/pulls';
import { reviewRuns } from '../../db/schema/review-runs';
import type { PullRequestSummary } from '../../vendor/shared/contracts/pulls';

export class ReviewSummariesRepository {
  constructor(private db: Db) {}

  async findById(workspaceId: string, prId: string): Promise<PullRequestSummary | null> {
    const [row] = await this.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.workspaceId, workspaceId))
      .where(eq(pullRequests.id, prId));
    if (!row) return null;
    return this.toDomain(row);
  }

  async countRunsForPr(workspaceId: string, prId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(reviewRuns)
      .where(eq(reviewRuns.prId, prId));
    return rows.length;
  }

  async listRecentIds(workspaceId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(eq(pullRequests.workspaceId, workspaceId))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  private toDomain(row: typeof pullRequests.$inferSelect): PullRequestSummary {
    return {
      id: row.id,
      title: row.title,
      number: row.number,
      state: row.state,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
