import type { FastifyReply } from 'fastify';
import { Container } from '../../platform/container';
import { S3StorageAdapter } from '../../adapters/storage/s3';
import type { ExportJob } from '../../vendor/shared/contracts/exports';

export class ExportsService {
  private storage: S3StorageAdapter;

  constructor(private container: Container) {
    this.storage = new S3StorageAdapter(container.config.s3Bucket);
  }

  async createExport(workspaceId: string, format: 'csv' | 'json'): Promise<ExportJob> {
    const rows = await this.container.reviewsRepo.listForExport(workspaceId);
    const key = `exports/${workspaceId}/${Date.now()}.${format}`;
    await this.storage.putObject(key, this.serialize(rows, format));
    return this.container.exportsRepo.create(workspaceId, key, format);
  }

  async streamTo(reply: FastifyReply, jobId: string): Promise<void> {
    const job = await this.container.exportsRepo.findById(jobId);
    const stream = await this.storage.getObjectStream(job.storageKey);
    reply.header('content-type', job.format === 'csv' ? 'text/csv' : 'application/json');
    reply.send(stream);
  }

  private serialize(rows: unknown[], format: 'csv' | 'json'): string {
    return format === 'json' ? JSON.stringify(rows) : rows.map((r) => JSON.stringify(r)).join('\n');
  }
}
