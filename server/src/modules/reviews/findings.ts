import type { FindingActionKind } from "@devdigest/shared";
import { AppError, NotFoundError } from "../../platform/errors.js";
import type { Container } from "../../platform/container.js";
import type { ReviewRepository } from "./repository.js";
import { findingRowToDto, type ReviewDtoFinding } from "./helpers.js";

/**
 * Finding actions: accept / dismiss / undo / learn / reply.
 * `learn` embeds note via container.embedder() and inserts a memory row.
 * `reply` stamps findings.repliedAt.
 */
export async function actOnFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
  container: Container,
  body?: { note?: string },
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError("Finding not found");
  }

  switch (action) {
    case "accept": {
      const row = await repo.setFindingAccepted(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case "dismiss": {
      const row = await repo.setFindingDismissed(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case "undo": {
      const row = await repo.clearFindingAction(findingId);
      return { finding: findingRowToDto(row!) };
    }
    case "learn": {
      const note = body?.note ?? ctx.finding.title;
      const embedder = await container.embedder();
      const [embedding] = await embedder.embed([note]);
      if (!embedding) throw new AppError("embed_failed", "Embedding failed", 500);
      await repo.insertMemory({
        workspaceId,
        repoId: ctx.pull.repoId ?? null,
        content: note,
        embedding,
        sources: {
          finding_id: findingId,
          agent_id: ctx.review.agentId ?? undefined,
          pr_id: ctx.pull.id,
        },
      });
      return { finding: findingRowToDto(ctx.finding) };
    }
    case "reply": {
      const row = await repo.setFindingReplied(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    default:
      throw new AppError(
        "invalid_action",
        `Action '${action as string}' is not supported`,
        400,
      );
  }
}
