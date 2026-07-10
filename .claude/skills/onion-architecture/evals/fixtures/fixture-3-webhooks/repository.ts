import { eq } from 'drizzle-orm';
import type { Database } from '../../platform/container';
import { webhookDeliveries } from '../../db/schema/webhooks';
import { ReposRepository } from '../repos/repository';
import { normalizeDeliveryStatus } from './service';
import type { WebhookDelivery } from '../../vendor/shared/contracts/webhooks';

export class WebhooksRepository {
  private reposRepo: ReposRepository;

  constructor(private db: Database) {
    this.reposRepo = new ReposRepository(db);
  }

  async listRecent(workspaceId: string): Promise<WebhookDelivery[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.workspaceId, workspaceId));

    const repo = await this.reposRepo.findByWorkspace(workspaceId);

    return rows.map((row) => ({
      id: row.id,
      repoName: repo?.name ?? 'unknown',
      status: normalizeDeliveryStatus(row.status),
      deliveredAt: row.deliveredAt.toISOString(),
    }));
  }
}
