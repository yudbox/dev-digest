import { eq, and } from 'drizzle-orm';
import type { Database } from '../../platform/container';
import { notifications } from '../../db/schema/notifications';
import type { Notification } from '../../vendor/shared/contracts/notifications';

export class NotificationsRepository {
  constructor(private db: Database) {}

  async listByWorkspace(workspaceId: string): Promise<Notification[]> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.workspaceId, workspaceId));
    return rows.map(this.toDomain);
  }

  async markRead(workspaceId: string, id: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.id, id)));
  }

  private toDomain(row: typeof notifications.$inferSelect): Notification {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      visibility: row.visibility,
      readAt: row.readAt?.toISOString() ?? null,
      body: row.body,
    };
  }
}
