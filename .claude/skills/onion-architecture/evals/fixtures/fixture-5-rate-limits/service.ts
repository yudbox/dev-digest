import { Container } from '../../platform/container';

export class RateLimitsService {
  constructor(private container: Container) {}

  async checkAndIncrement(workspaceId: string) {
    const status = await this.container.rateLimitsRepo.checkStatus(workspaceId);
    if (status.throttled) {
      return status;
    }
    await this.container.rateLimitsRepo.increment(workspaceId);
    return status;
  }
}
