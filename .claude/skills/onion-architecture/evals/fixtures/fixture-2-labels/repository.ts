import { eq } from 'drizzle-orm';
import type { Database } from '../../platform/container';
import { labels } from '../../db/schema/labels';
import type { Label } from '../../vendor/shared/contracts/labels';

export class LabelsRepository {
  constructor(private db: Database) {}

  async listByRepo(repoId: string): Promise<Label[]> {
    const rows = await this.db.select().from(labels).where(eq(labels.repoId, repoId));
    return rows.map(this.toDomain);
  }

  async insert(repoId: string, name: string, color: string): Promise<Label> {
    const [row] = await this.db.insert(labels).values({ repoId, name, color }).returning();
    return this.toDomain(row);
  }

  private toDomain(row: typeof labels.$inferSelect): Label {
    return { id: row.id, name: row.name, color: row.color };
  }
}
