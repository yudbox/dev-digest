import type { FindingActionKind, FindingRepliesResponse, FindingReply } from "@devdigest/shared";
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

// ===========================================================================
// Finding thread management (read / reply / edit / delete)
// ===========================================================================

/** Resolve finding + its associated PR + repo, workspace-scoped. */
async function resolveFindingContext(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
) {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError("Finding not found");
  }
  const repoRow = await repo.getRepo(ctx.pull.repoId!);
  if (!repoRow) throw new NotFoundError("Repo not found");
  return { ...ctx, repoRow };
}

function toFindingReplyDto(
  row: { id: string; body: string; createdAt: Date; updatedAt: Date },
  adoAuthor: string,
  ownerEmail: string,
): FindingReply {
  return {
    id: row.id,
    body: row.body,
    author: adoAuthor,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    is_own: adoAuthor === ownerEmail,
  };
}

function adoThreadUrl(repoRow: {
  baseUrl: string | null;
  owner: string;
  project: string | null;
  name: string;
}, prNumber: number, threadId: number): string {
  const base = (repoRow.baseUrl ?? "https://dev.azure.com").replace(/\/+$/, "");
  const org = encodeURIComponent(repoRow.owner);
  const project = encodeURIComponent(repoRow.project ?? "");
  const repoName = encodeURIComponent(repoRow.name);
  return `${base}/${org}/${project}/_git/${repoName}/pullrequest/${prNumber}?discussionId=${threadId}`;
}

/**
 * Publish a comment on the finding's ADO thread (initial publish or idempotent
 * re-publish) and persist the ado_thread_id+ado_comment_id in finding_replies.
 * This replaces the two-call pattern (POST /pulls/:id/comments + POST /findings/:id/reply).
 */
export async function publishFindingReply(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  body: string,
  container: Container,
  ownerEmail: string,
): Promise<FindingRepliesResponse> {
  const { ctx, repoRow, pull } = await (async () => {
    const ctx = await repo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError("Finding not found");
    const repoRow = await repo.getRepo(ctx.pull.repoId!);
    if (!repoRow) throw new NotFoundError("Repo not found");
    return { ctx, repoRow, pull: ctx.pull };
  })();

  let vcs;
  try {
    vcs = await container.vcs(repoRow);
  } catch {
    throw new AppError("vcs_unavailable", "VCS client unavailable", 400);
  }

  const comment = await vcs.publishComment(
    {
      owner: repoRow.owner,
      name: repoRow.name,
      project: repoRow.project ?? undefined,
      baseUrl: repoRow.baseUrl ?? undefined,
    },
    pull.number,
    {
      commitId: pull.headSha,
      path: ctx.finding.file,
      line: ctx.finding.startLine,
      side: "RIGHT",
      body,
      severity: ctx.finding.severity,
      title: ctx.finding.title,
    },
  );

  const adoThreadId = comment.thread_id ?? null;
  const adoCommentId = comment.id;

  // Persist in finding_replies only when ADO returns a thread id
  let replyRow;
  if (adoThreadId != null) {
    replyRow = await repo.insertFindingReply({
      findingId,
      adoThreadId,
      adoCommentId,
      body,
    });
    await repo.setFindingReplied(findingId, new Date());
  } else {
    // GitHub or provider without thread ids — stamp replied_at only
    await repo.setFindingReplied(findingId, new Date());
    return {
      replies: [],
      ado_thread_url: null,
    };
  }

  const dto = toFindingReplyDto(replyRow, ownerEmail, ownerEmail);
  return {
    replies: [dto],
    ado_thread_url: adoThreadUrl(repoRow, pull.number, adoThreadId),
  };
}

/** Fetch all published comments for a finding from ADO. */
export async function getFindingReplies(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  container: Container,
  ownerEmail: string,
): Promise<FindingRepliesResponse> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError("Finding not found");
  const repoRow = await repo.getRepo(ctx.pull.repoId!);
  if (!repoRow) throw new NotFoundError("Repo not found");

  const rows = await repo.getFindingReplies(findingId);
  if (rows.length === 0) return { replies: [], ado_thread_url: null };

  // All rows for one finding share the same thread (ADO idempotency R33)
  const firstThreadId = rows[0]!.adoThreadId;

  // Use stored data — author is the workspace owner (we only store our own published comments)
  const replies: FindingReply[] = rows.map((row) =>
    toFindingReplyDto(
      { id: row.id, body: row.body, createdAt: row.createdAt, updatedAt: row.updatedAt },
      ownerEmail,
      ownerEmail,
    ),
  );

  return {
    replies,
    ado_thread_url: adoThreadUrl(repoRow, ctx.pull.number, firstThreadId),
  };
}

/** Add a reply to an existing finding thread (reply to reply). */
export async function addFindingReply(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  body: string,
  container: Container,
  ownerEmail: string,
): Promise<FindingRepliesResponse> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError("Finding not found");
  const repoRow = await repo.getRepo(ctx.pull.repoId!);
  if (!repoRow) throw new NotFoundError("Repo not found");

  const existingRows = await repo.getFindingReplies(findingId);
  if (existingRows.length === 0) {
    throw new AppError("thread_not_found", "No published thread found for this finding. Publish a comment first.", 400);
  }

  const threadId = existingRows[0]!.adoThreadId;

  let vcs;
  try {
    vcs = await container.vcs(repoRow);
  } catch {
    throw new AppError("vcs_unavailable", "VCS client unavailable", 400);
  }

  const comment = await vcs.publishComment(
    {
      owner: repoRow.owner,
      name: repoRow.name,
      project: repoRow.project ?? undefined,
      baseUrl: repoRow.baseUrl ?? undefined,
    },
    ctx.pull.number,
    {
      commitId: ctx.pull.headSha,
      path: ctx.finding.file,
      line: ctx.finding.startLine,
      side: "RIGHT",
      body,
      inReplyTo: threadId,
    },
  );

  const newRow = await repo.insertFindingReply({
    findingId,
    adoThreadId: threadId,
    adoCommentId: comment.id,
    body,
  });

  return getFindingReplies(repo, workspaceId, findingId, container, ownerEmail);
}

/** Edit own published comment. */
export async function editFindingReply(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  replyId: string,
  body: string,
  container: Container,
  ownerEmail: string,
): Promise<FindingRepliesResponse> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError("Finding not found");
  const repoRow = await repo.getRepo(ctx.pull.repoId!);
  if (!repoRow) throw new NotFoundError("Repo not found");

  const replyRow = await repo.getFindingReply(replyId);
  if (!replyRow || replyRow.findingId !== findingId) throw new NotFoundError("Reply not found");

  const vcs = await container.vcs(repoRow);
  try {
    await vcs.editComment(
      { owner: repoRow.owner, name: repoRow.name, project: repoRow.project ?? undefined, baseUrl: repoRow.baseUrl ?? undefined },
      ctx.pull.number,
      replyRow.adoThreadId,
      replyRow.adoCommentId,
      body,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError("edit_failed", msg, 400);
  }

  await repo.updateFindingReply(replyId, body);
  return getFindingReplies(repo, workspaceId, findingId, container, ownerEmail);
}

/** Delete own published comment. */
export async function deleteFindingReply(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  replyId: string,
  container: Container,
): Promise<{ ok: boolean }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError("Finding not found");
  const repoRow = await repo.getRepo(ctx.pull.repoId!);
  if (!repoRow) throw new NotFoundError("Repo not found");

  const replyRow = await repo.getFindingReply(replyId);
  if (!replyRow || replyRow.findingId !== findingId) throw new NotFoundError("Reply not found");

  const vcs = await container.vcs(repoRow);
  try {
    await vcs.deleteComment(
      { owner: repoRow.owner, name: repoRow.name, project: repoRow.project ?? undefined, baseUrl: repoRow.baseUrl ?? undefined },
      ctx.pull.number,
      replyRow.adoThreadId,
      replyRow.adoCommentId,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError("delete_failed", msg, 400);
  }

  await repo.deleteFindingReply(replyId);
  return { ok: true };
}
