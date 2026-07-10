import { Container } from '../../platform/container';

export function normalizeDeliveryStatus(status: string): 'ok' | 'failed' | 'pending' {
  if (status === 'success') return 'ok';
  if (status === 'error' || status === 'timeout') return 'failed';
  return 'pending';
}

export class WebhooksService {
  constructor(private container: Container) {}

  async listRecent(workspaceId: string) {
    return this.container.webhooksRepo.listRecent(workspaceId);
  }
}
