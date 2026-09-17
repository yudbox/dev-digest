import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import * as GitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type {
  RepoRef,
  CreateReviewCommentInput,
} from "../../vendor/shared/adapters.js";
import type { PrReviewComment } from "../../vendor/shared/contracts/platform.js";
import { ValidationError } from "../../platform/errors.js";
import { findingId } from "./finding-id.js";

/**
 * TASK-008 (SPEC-2026-08-25-azure-devops-integration): Azure DevOps has no
 * inline-review-comment endpoint and no batch-review endpoint - PR feedback
 * is thread-based, one POST per thread, with an arbitrary properties bag as
 * the only place to stash an application-defined marker. This module is the
 * ADO-specific half of VcsClient.publishComment/listReviewComments -
 * client.ts's not_supported stubs delegate here.
 *
 * Idempotency (R33): GET threads, match on properties['devdigest.findingId'],
 * add a new comment to the existing thread when found instead of creating a
 * new one (see the "PATCH cannot touch properties" note below for why this
 * is NOT a properties update). A free-form reply (input.inReplyTo set) skips
 * matching entirely and always adds a comment to the named thread (R34).
 *
 * Positioning (R38, decision R-D): pullRequestThreadContext.changeTrackingId
 * is what lets Azure DevOps re-anchor a thread to the right line after a new
 * iteration is pushed. It is looked up from the SAME iteration/changes data
 * client.ts already fetches for the read path (TASK-006) - the caller must
 * pass it in; when unavailable (file not present in the latest iteration's
 * change list, or the SDK's iterationContext data is missing), threads.ts
 * degrades to a plain threadContext with no pullRequestThreadContext at all -
 * the comment still gets created, just without ADO's automatic re-anchoring.
 *
 * TWO facts below were confirmed empirically against a real Azure DevOps
 * organization during TASK-008 development (org GES-IT, repo
 * ges-azure-functions, PR #6557) - neither is documented clearly enough in
 * ADO's REST docs to have gotten right from reading them alone, and both
 * contradict what a first read of Renovate's azure/index.ts (the plan's
 * cited architecture reference) would suggest:
 *
 * 1. properties wire shape is { [key]: { $type: "System.String", $value:
 *    <string> } } - WITH the '$' prefix on both sub-keys. Posting the more
 *    obvious { type: 'String', value: <string> } shape (no '$') is silently
 *    ACCEPTED by createThread (no error) but the property never round-trips
 *    - a follow-up getThreads call shows only ADO's own
 *    Microsoft.TeamFoundation.Discussion.UniqueID property, and the
 *    application-defined one is simply gone. This is the single most
 *    dangerous failure mode in this whole module: it looks like success.
 *
 * 2. updateThread REJECTS any request body containing a `properties` field
 *    on an already-created thread, with a hard 400: "Comment thread
 *    properties cannot be updated. Parameter name: Properties". properties
 *    can be set ONLY at createThread time and are immutable afterward. This
 *    directly contradicts the plan's original TASK-008 design ("PATCH
 *    updates the thread's own fields (status/properties)") - the idempotent
 *    re-publish path below does NOT call updateThread with a properties
 *    field at all; updateThread is used only (optionally) to touch `status`.
 */

const FINDING_ID_PROPERTY = "devdigest.findingId";

interface AdoPropertiesCollection {
  [key: string]: { $type: "System.String"; $value: string };
}

function findingIdProperties(id: string): AdoPropertiesCollection {
  return { [FINDING_ID_PROPERTY]: { $type: "System.String", $value: id } };
}

function readFindingIdProperty(
  thread: GitInterfaces.GitPullRequestCommentThread,
): string | undefined {
  const props = thread.properties as AdoPropertiesCollection | undefined;
  const entry = props?.[FINDING_ID_PROPERTY];
  return entry?.$value;
}

/** A thread with all comments deleted still comes back from GET threads with
 * isDeleted set at the thread level, or with every comment individually
 * marked deleted - either way it must not match as "the existing thread" for
 * a finding, or a re-publish would add a comment to a thread nobody can see. */
function isLiveThread(thread: GitInterfaces.GitPullRequestCommentThread): boolean {
  if (thread.isDeleted) return false;
  const comments = thread.comments ?? [];
  return comments.some((c) => !c.isDeleted);
}

/**
 * Content-policy guard-clause (not part of the plan's original R-numbered
 * requirements - added after live testing surfaced a real leak: a
 * non-English comment is both unreadable to the rest of an international
 * team and, in this project's case, an accidental signal that an internal
 * tool published it). Deliberately mechanical, not a real language
 * classifier: it flags the presence of any character from a short list of
 * non-Latin scripts (the concrete failure mode this project actually hit
 * was Cyrillic). It will not catch every non-English sentence written in
 * Latin script, and that tradeoff is intentional - a classifier confident
 * enough to do that reliably is a model call, and this is a pre-publish gate
 * that must stay a zero-cost, zero-network check.
 */
const NON_LATIN_SCRIPT = /[Ѐ-ӿԀ-ԯ֐-׿؀-ۿऀ-ॿ぀-ヿ一-鿿가-힯]/u;

export function assertEnglishBody(body: string): void {
  if (NON_LATIN_SCRIPT.test(body)) {
    throw new ValidationError(
      "Comment body must be in English (non-Latin-script characters detected) - this pull request may be shared with an international team.",
    );
  }
}

export interface ThreadRepoContext {
  git: IGitApi;
  repositoryId: string;
  project: string;
  pullRequestId: number;
  repo: Pick<RepoRef, "owner" | "name" | "project" | "baseUrl">;
  baseUrl: string;
  /** ADO's per-file changeTrackingId for the CURRENT (latest) iteration, when
   * known - keyed by repo-relative path exactly as ADO returns it (leading
   * slash, e.g. "/apps/order-functions/.../order-processing-handler.ts"). */
  changeTrackingIdByPath?: Record<string, number>;
}

function toAdoPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * threadContext / pullRequestThreadContext for a NEW thread on `path:line`.
 * `side` mirrors GitHub's LEFT/RIGHT (default RIGHT - a comment on the
 * current/new version of the file, which is the overwhelming majority case
 * for a finding raised against the PR's head). ADO requires BOTH a start and
 * an end position for a thread's span; a single-line comment sets both ends
 * of the SAME side to the SAME line.
 */
function buildThreadContext(
  ctx: ThreadRepoContext,
  input: Pick<CreateReviewCommentInput, "path" | "line" | "side">,
): Pick<GitInterfaces.GitPullRequestCommentThread, "threadContext" | "pullRequestThreadContext"> {
  const position: GitInterfaces.CommentPosition = { line: input.line, offset: 1 };
  const side = input.side ?? "RIGHT";
  const threadContext: GitInterfaces.CommentThreadContext = {
    filePath: toAdoPath(input.path),
    ...(side === "RIGHT"
      ? { rightFileStart: position, rightFileEnd: position }
      : { leftFileStart: position, leftFileEnd: position }),
  };

  const changeTrackingId = ctx.changeTrackingIdByPath?.[toAdoPath(input.path)];
  if (changeTrackingId == null) {
    // Graceful degradation (R-D): comment still gets created, just without
    // ADO's automatic re-anchoring across future iterations.
    return { threadContext };
  }
  return {
    threadContext,
    pullRequestThreadContext: { changeTrackingId },
  };
}

/** Every field except html_url - the caller always has the real ctx needed
 *  to build that URL (R37) and sets it after calling this. */
function mapCommentToPrReviewComment(
  thread: GitInterfaces.GitPullRequestCommentThread,
  comment: GitInterfaces.Comment,
): Omit<PrReviewComment, "html_url"> {
  const path = thread.threadContext?.filePath ?? "";
  const line =
    thread.threadContext?.rightFileStart?.line ??
    thread.threadContext?.leftFileStart?.line ??
    null;
  const side: "LEFT" | "RIGHT" = thread.threadContext?.rightFileStart != null ? "RIGHT" : "LEFT";
  return {
    id: comment.id ?? 0,
    path: path.startsWith("/") ? path.slice(1) : path,
    line,
    original_line: line,
    side,
    body: comment.content ?? "",
    user: comment.author?.displayName ?? comment.author?.uniqueName ?? "unknown",
    created_at: (comment.publishedDate ?? new Date()).toISOString(),
    in_reply_to_id: null,
    is_outdated: false,
    thread_id: thread.id ?? null,
  };
}

/** R37: {baseUrl}/{org}/{project}/_git/{repo}/pullrequest/{id}?discussionId={threadId} */
function threadHtmlUrl(ctx: ThreadRepoContext, threadId: number): string {
  const base = ctx.baseUrl.replace(/\/+$/, "");
  const org = encodeURIComponent(ctx.repo.owner);
  const project = encodeURIComponent(ctx.repo.project ?? "");
  const repo = encodeURIComponent(ctx.repo.name);
  return `${base}/${org}/${project}/_git/${repo}/pullrequest/${ctx.pullRequestId}?discussionId=${threadId}`;
}

async function findThreadByFindingId(
  ctx: ThreadRepoContext,
  id: string,
): Promise<GitInterfaces.GitPullRequestCommentThread | undefined> {
  const threads = await ctx.git.getThreads(ctx.repositoryId, ctx.pullRequestId, ctx.project);
  return threads.find((t) => isLiveThread(t) && readFindingIdProperty(t) === id);
}

/**
 * New thread. `content` is the FULL comment body - unlike GitHub's
 * inline-comment model, ADO threads carry the finding text as the thread's
 * first (and, on create, only) comment. `properties` is set HERE and only
 * here - see the module doc comment's finding (2): it can never be changed
 * again after this call succeeds.
 */
async function createThread(
  ctx: ThreadRepoContext,
  input: CreateReviewCommentInput,
  id: string,
): Promise<PrReviewComment> {
  const { threadContext, pullRequestThreadContext } = buildThreadContext(ctx, input);
  const thread: GitInterfaces.GitPullRequestCommentThread = {
    comments: [{ content: input.body, commentType: GitInterfaces.CommentType.Text }],
    status: GitInterfaces.CommentThreadStatus.Active,
    threadContext,
    pullRequestThreadContext,
    properties: findingIdProperties(id),
  };
  const created = await ctx.git.createThread(thread, ctx.repositoryId, ctx.pullRequestId, ctx.project);
  const comment = created.comments?.[0];
  if (!comment) {
    throw new Error("Azure DevOps createThread returned no comment on the new thread");
  }
  return { ...mapCommentToPrReviewComment(created, comment), html_url: threadHtmlUrl(ctx, created.id ?? 0) };
}

/**
 * Existing thread, same finding (R33). `properties` is immutable once a
 * thread exists (module doc comment, finding 2) - so "updating" a finding on
 * re-publish can only mean: add a fresh comment carrying the new text
 * (history stays visible, nothing is overwritten in place), and optionally
 * nudge the thread's `status` back to Active via updateThread WITH NO
 * `properties` FIELD IN THE REQUEST BODY AT ALL - including an empty object
 * `{}` is safe (ADO only rejects a `properties` key that is actually
 * present), but this function never sends one, to make that guarantee
 * visible in the code rather than relying on "empty happens to be fine".
 */
async function republishInExistingThread(
  ctx: ThreadRepoContext,
  existing: GitInterfaces.GitPullRequestCommentThread,
  input: CreateReviewCommentInput,
): Promise<PrReviewComment> {
  const threadId = existing.id;
  if (threadId == null) {
    throw new Error("Azure DevOps thread matched by findingId has no id");
  }
  const newComment = await ctx.git.createComment(
    { content: input.body, commentType: GitInterfaces.CommentType.Text },
    ctx.repositoryId,
    ctx.pullRequestId,
    threadId,
    ctx.project,
  );
  if (existing.status !== GitInterfaces.CommentThreadStatus.Active) {
    await ctx.git.updateThread(
      { status: GitInterfaces.CommentThreadStatus.Active },
      ctx.repositoryId,
      ctx.pullRequestId,
      threadId,
      ctx.project,
    );
  }
  return { ...mapCommentToPrReviewComment(existing, newComment), html_url: threadHtmlUrl(ctx, threadId) };
}

/** R34: a free reply is NOT idempotency-tracked - always a new comment on
 *  the NAMED thread. R36: input.inReplyTo is the ADO thread id for this
 *  provider (not a comment id, unlike GitHub). */
async function replyInThread(
  ctx: ThreadRepoContext,
  threadId: number,
  body: string,
): Promise<PrReviewComment> {
  const comment = await ctx.git.createComment(
    { content: body, commentType: GitInterfaces.CommentType.Text },
    ctx.repositoryId,
    ctx.pullRequestId,
    threadId,
    ctx.project,
  );
  const threads = await ctx.git.getThreads(ctx.repositoryId, ctx.pullRequestId, ctx.project);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) {
    throw new Error(`Azure DevOps thread ${threadId} not found after replying to it`);
  }
  return { ...mapCommentToPrReviewComment(thread, comment), html_url: threadHtmlUrl(ctx, threadId) };
}

export async function publishThreadComment(
  ctx: ThreadRepoContext,
  input: CreateReviewCommentInput,
): Promise<PrReviewComment> {
  assertEnglishBody(input.body);

  if (input.inReplyTo != null) {
    return replyInThread(ctx, input.inReplyTo, input.body);
  }
  const id = findingId({
    repoOwner: ctx.repo.owner,
    repoProject: ctx.repo.project,
    repoName: ctx.repo.name,
    prNumber: ctx.pullRequestId,
    path: input.path,
    line: input.line,
    severity: input.severity ?? "",
    title: input.title ?? "",
  });
  const existing = await findThreadByFindingId(ctx, id);
  if (existing) {
    return republishInExistingThread(ctx, existing, input);
  }
  return createThread(ctx, input, id);
}

export interface ThreadComment {
  adoThreadId: number;
  adoCommentId: number;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/** Read all non-deleted Text comments from a single thread by id. */
export async function getThreadComments(
  ctx: ThreadRepoContext,
  threadId: number,
): Promise<ThreadComment[]> {
  const threads = await ctx.git.getThreads(ctx.repositoryId, ctx.pullRequestId, ctx.project);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread || thread.isDeleted) return [];
  const out: ThreadComment[] = [];
  for (const c of thread.comments ?? []) {
    if (c.isDeleted) continue;
    if (c.commentType !== GitInterfaces.CommentType.Text) continue;
    out.push({
      adoThreadId: threadId,
      adoCommentId: c.id ?? 0,
      body: c.content ?? "",
      author: c.author?.uniqueName ?? c.author?.displayName ?? "unknown",
      createdAt: (c.publishedDate ?? new Date()).toISOString(),
      updatedAt: (c.lastUpdatedDate ?? c.publishedDate ?? new Date()).toISOString(),
    });
  }
  return out;
}

/** Edit the body of an existing comment. English-only policy applies. */
export async function updateThreadComment(
  ctx: ThreadRepoContext,
  threadId: number,
  commentId: number,
  body: string,
): Promise<void> {
  assertEnglishBody(body);
  await ctx.git.updateComment(
    { content: body, commentType: GitInterfaces.CommentType.Text },
    ctx.repositoryId,
    ctx.pullRequestId,
    threadId,
    commentId,
    ctx.project,
  );
}

/** Delete a comment. ADO rejects deleting the first comment when replies exist — caller handles the error. */
export async function deleteThreadComment(
  ctx: ThreadRepoContext,
  threadId: number,
  commentId: number,
): Promise<void> {
  await ctx.git.deleteComment(
    ctx.repositoryId,
    ctx.pullRequestId,
    threadId,
    commentId,
    ctx.project,
  );
}

/**
 * R35/AC-008-6: flatten GET threads into a plain PrReviewComment[],
 * excluding system-generated threads (ADO auto-posts a System-type comment
 * on events like "iteration pushed") and deleted comments/threads. Only
 * CommentType.Text is treated as a real, user/API-authored comment -
 * CommentType.CodeChange (ADO's own auto-annotations) and
 * CommentType.System are both excluded. Confirmed against a real PR's
 * threads during TASK-008 development: 8 of 14 existing comments on that PR
 * were CommentType.System (type=3) - without this filter every one of them
 * would have surfaced in the API response as if it were a review comment.
 */
export async function listThreadComments(ctx: ThreadRepoContext): Promise<PrReviewComment[]> {
  const threads = await ctx.git.getThreads(ctx.repositoryId, ctx.pullRequestId, ctx.project);
  const out: PrReviewComment[] = [];
  for (const thread of threads) {
    if (thread.isDeleted) continue;
    for (const comment of thread.comments ?? []) {
      if (comment.isDeleted) continue;
      if (comment.commentType !== GitInterfaces.CommentType.Text) continue;
      out.push({
        ...mapCommentToPrReviewComment(thread, comment),
        html_url: threadHtmlUrl(ctx, thread.id ?? 0),
      });
    }
  }
  return out;
}
