import { eq } from 'drizzle-orm';
import { Container } from '../../platform/container';
import { labels } from '../../db/schema/labels';
import type { Label } from '../../vendor/shared/contracts/labels';

export class LabelsService {
  constructor(private container: Container) {}

  async listByRepo(repoId: string): Promise<Label[]> {
    const rows = await this.container.db
      .select()
      .from(labels)
      .where(eq(labels.repoId, repoId));
    return rows.map((row) => ({ id: row.id, name: row.name, color: row.color }));
  }

  async create(repoId: string, name: string, color: string): Promise<Label> {
    const [row] = await this.container.db
      .insert(labels)
      .values({ repoId, name, color })
      .returning();
    return { id: row.id, name: row.name, color: row.color };
  }
}
