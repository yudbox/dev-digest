import type { Container } from "../../platform/container.js";
import type { BlastRadiusResult } from "@devdigest/shared";
import { NotFoundError } from "../../platform/errors.js";
import { BlastRepository } from "./repository.js";

export class BlastService {
  private readonly repo: BlastRepository;

  constructor(private readonly container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  async getForPr(
    prId: string,
    workspaceId: string,
  ): Promise<BlastRadiusResult> {
    const { pr, repo } = await this.repo.resolvePrAndRepo(prId, workspaceId);
    if (!pr) throw new NotFoundError("Pull request not found");
    if (!repo) throw new NotFoundError("Repo not found");

    const changedFiles = await this.repo.getChangedFilePaths(pr.id);

    if (changedFiles.length === 0) {
      return {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: "no_data",
        summary: buildSummary(0, 0, 0, 0),
      };
    }

    const blastResult = await this.container.repoIntel.getBlastRadius(
      repo.id,
      changedFiles,
    );

    const priorPrsRaw = await this.repo.findPriorPrsTouchingSameFiles(
      repo.id,
      pr.id,
      changedFiles,
    );

    const priorPrs = priorPrsRaw.map(
      (p: {
        id: string;
        number: number;
        title: string;
        openedAt: Date | null;
        status: string;
      }) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        openedAt: p.openedAt ? p.openedAt.toISOString() : null,
        status: p.status,
      }),
    );

    const cronCount = new Set(
      Object.values(blastResult.factsByFile ?? {}).flatMap((f) => f.crons),
    ).size;
    const summary = buildSummary(
      blastResult.changedSymbols.length,
      blastResult.callers.length,
      blastResult.impactedEndpoints.length,
      cronCount,
    );

    return { ...blastResult, priorPrs, summary };
  }
}

/** Deterministic one-line summary built from the map's counts — no LLM. */
function buildSummary(
  symbols: number,
  callers: number,
  endpoints: number,
  crons: number,
): string {
  return `${symbols} symbols · ${callers} callers · ${endpoints} endpoints · ${crons} crons`;
}
