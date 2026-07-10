import { Container } from '../../platform/container';
import type { PullRequestSummary } from '../../vendor/shared/contracts/pulls';

export interface DashboardSummary {
  pull: PullRequestSummary;
  runCount: number;
}

export class ReviewSummariesService {
  constructor(private container: Container) {}

  async summarizeRecent(workspaceId: string, limit: number): Promise<DashboardSummary[]> {
    const ids = await this.container.reviewSummariesRepo.listRecentIds(workspaceId, limit);

    const summaries: DashboardSummary[] = [];
    for (const id of ids) {
      const pull = await this.container.reviewSummariesRepo.findById(workspaceId, id);
      if (!pull) continue;
      const runCount = await this.container.reviewSummariesRepo.countRunsForPr(workspaceId, id);
      summaries.push({ pull, runCount });
    }

    return summaries;
  }

  async summaryForOne(workspaceId: string, prId: string): Promise<DashboardSummary | null> {
    const pull = await this.container.reviewSummariesRepo.findById(workspaceId, prId);
    if (!pull) return null;
    const runCount = await this.container.reviewSummariesRepo.countRunsForPr(workspaceId, prId);
    return { pull, runCount };
  }
}
