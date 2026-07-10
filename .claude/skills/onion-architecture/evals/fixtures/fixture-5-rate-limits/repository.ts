import { eq } from 'drizzle-orm';
import type { Database } from '../../platform/container';
import { requestCounters } from '../../db/schema/rate-limits';
import type { RateLimitStatus } from '../../vendor/shared/contracts/rate-limits';

export class RateLimitsRepository {
  constructor(private db: Database) {}

  async checkStatus(workspaceId: string): Promise<RateLimitStatus> {
    const enabled = process.env.RATE_LIMIT_ENABLED === 'true';
    if (!enabled) {
      return { throttled: false, remaining: null };
    }

    const maxRequests = Number(process.env.RATE_LIMIT_MAX ?? '1000');
    const [row] = await this.db
      .select()
      .from(requestCounters)
      .where(eq(requestCounters.workspaceId, workspaceId));

    const used = row?.count ?? 0;
    return {
      throttled: used >= maxRequests,
      remaining: Math.max(0, maxRequests - used),
    };
  }

  async increment(workspaceId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(requestCounters)
      .where(eq(requestCounters.workspaceId, workspaceId));

    if (!row) {
      await this.db.insert(requestCounters).values({ workspaceId, count: 1 });
      return;
    }

    await this.db
      .update(requestCounters)
      .set({ count: row.count + 1 })
      .where(eq(requestCounters.workspaceId, workspaceId));
  }
}
