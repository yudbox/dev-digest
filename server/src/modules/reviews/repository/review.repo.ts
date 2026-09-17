import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import * as t from "../../../db/schema.js";
import type { Finding } from "@devdigest/shared";
import type { FindingRow, PullRow } from "../../../db/rows.js";

export type ReviewRow = typeof t.reviews.$inferSelect;

// ---- reviews + findings ---------------------------------------------------

export async function insertReview(
  db: Db,
  values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: "summary" | "review";
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  },
): Promise<ReviewRow> {
  const [row] = await db.insert(t.reviews).values(values).returning();
  return row!;
}

export async function insertFindings(
  db: Db,
  reviewId: string,
  findings: Finding[],
): Promise<FindingRow[]> {
  if (findings.length === 0) return [];
  const rows = await db
    .insert(t.findings)
    .values(
      findings.map((f) => ({
        reviewId,
        file: f.file,
        startLine: f.start_line,
        endLine: f.end_line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        kind: f.kind ?? "finding",
        trifectaComponents: f.trifecta_components ?? null,
      })),
    )
    .returning();
  return rows;
}

/** Reviews for a PR (newest first), each with its findings. */
export async function reviewsForPull(
  db: Db,
  prId: string,
): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
  const reviews = await db
    .select()
    .from(t.reviews)
    .where(eq(t.reviews.prId, prId))
    .orderBy(desc(t.reviews.createdAt));
  if (reviews.length === 0) return [];
  const ids = reviews.map((r) => r.id);
  const findings = await db
    .select()
    .from(t.findings)
    .where(inArray(t.findings.reviewId, ids));
  return reviews.map((review) => ({
    review,
    findings: findings.filter((f) => f.reviewId === review.id),
  }));
}

export async function getReview(
  db: Db,
  reviewId: string,
): Promise<ReviewRow | undefined> {
  const [row] = await db
    .select()
    .from(t.reviews)
    .where(eq(t.reviews.id, reviewId));
  return row;
}

/** Delete a whole review (one agent's run) + its findings (cascade), scoped
 *  to the workspace. Returns false if not found in the workspace. */
export async function deleteReview(
  db: Db,
  workspaceId: string,
  reviewId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.reviews)
    .where(
      and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)),
    )
    .returning({ id: t.reviews.id });
  return rows.length > 0;
}

// ---- finding actions ------------------------------------------------------

export async function getFinding(
  db: Db,
  findingId: string,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .select()
    .from(t.findings)
    .where(eq(t.findings.id, findingId));
  return row;
}

/** Resolve workspace_id + pr_id for a finding (via review → pr). */
export async function findingContext(
  db: Db,
  findingId: string,
): Promise<
  { finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined
> {
  const finding = await getFinding(db, findingId);
  if (!finding) return undefined;
  const review = await getReview(db, finding.reviewId);
  if (!review) return undefined;
  const [pull] = await db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, review.prId));
  if (!pull) return undefined;
  return { finding, review, pull };
}

export async function setFindingAccepted(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ acceptedAt: at, dismissedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

export async function setFindingDismissed(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ dismissedAt: at, acceptedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

export async function setFindingReplied(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ repliedAt: at })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

// ---- smart diff data -------------------------------------------------------

export interface LatestReviewData {
  agentId: string | null;
  findings: Array<{
    id: string;
    file: string;
    title: string;
    severity: string;
    startLine: number;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  }>;
  reviewTokens: number | null;
}

/**
 * Returns the latest findings per agent for a PR — one entry per distinct
 * agent that has reviewed it, each containing only that agent's most recent
 * review's findings. Returns [] when no review has run yet.
 *
 * This replaces the old "global LIMIT 1" query that silently discarded every
 * agent's findings except whichever agent ran most recently overall.
 */
export async function getLatestReviewData(
  db: Db,
  prId: string,
): Promise<LatestReviewData[]> {
  const allReviews = await db
    .select()
    .from(t.reviews)
    .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, "review")))
    .orderBy(desc(t.reviews.createdAt));

  if (allReviews.length === 0) return [];

  // Keep the most recent review per agent (DESC order → first-seen wins)
  const latestByAgent = new Map<string, (typeof allReviews)[0]>();
  for (const review of allReviews) {
    const key = review.agentId ?? "_null";
    if (!latestByAgent.has(key)) latestByAgent.set(key, review);
  }

  const latestReviews = [...latestByAgent.values()];
  const reviewIds = latestReviews.map((r) => r.id);

  const allFindings = await db
    .select({
      id: t.findings.id,
      reviewId: t.findings.reviewId,
      file: t.findings.file,
      title: t.findings.title,
      severity: t.findings.severity,
      startLine: t.findings.startLine,
      acceptedAt: t.findings.acceptedAt,
      dismissedAt: t.findings.dismissedAt,
    })
    .from(t.findings)
    .where(inArray(t.findings.reviewId, reviewIds));

  const runIds = latestReviews.map((r) => r.runId).filter(Boolean) as string[];
  const runRows =
    runIds.length > 0
      ? await db
          .select({
            id: t.agentRuns.id,
            tokensIn: t.agentRuns.tokensIn,
            tokensOut: t.agentRuns.tokensOut,
          })
          .from(t.agentRuns)
          .where(inArray(t.agentRuns.id, runIds))
      : [];
  const runTokensMap = new Map(
    runRows.map((r) => [r.id, (r.tokensIn ?? 0) + (r.tokensOut ?? 0)]),
  );

  return latestReviews.map((review) => ({
    agentId: review.agentId,
    findings: allFindings
      .filter((f) => f.reviewId === review.id)
      .map((f) => ({
        id: f.id,
        file: f.file,
        title: f.title,
        severity: f.severity,
        startLine: f.startLine,
        acceptedAt: f.acceptedAt,
        dismissedAt: f.dismissedAt,
      })),
    reviewTokens: review.runId
      ? (runTokensMap.get(review.runId) ?? null)
      : null,
  }));
}

// ---- finding replies -------------------------------------------------------

export type FindingReplyRow = typeof t.findingReplies.$inferSelect;

export async function insertFindingReply(
  db: Db,
  values: { findingId: string; adoThreadId: number; adoCommentId: number; body: string },
): Promise<FindingReplyRow> {
  const [row] = await db.insert(t.findingReplies).values(values).returning();
  return row!;
}

export async function getFindingReplies(
  db: Db,
  findingId: string,
): Promise<FindingReplyRow[]> {
  return db
    .select()
    .from(t.findingReplies)
    .where(eq(t.findingReplies.findingId, findingId))
    .orderBy(t.findingReplies.createdAt);
}

export async function getFindingReply(
  db: Db,
  replyId: string,
): Promise<FindingReplyRow | undefined> {
  const [row] = await db
    .select()
    .from(t.findingReplies)
    .where(eq(t.findingReplies.id, replyId));
  return row;
}

export async function updateFindingReply(
  db: Db,
  replyId: string,
  body: string,
): Promise<FindingReplyRow | undefined> {
  const [row] = await db
    .update(t.findingReplies)
    .set({ body, updatedAt: sql`now()` })
    .where(eq(t.findingReplies.id, replyId))
    .returning();
  return row;
}

export async function deleteFindingReply(
  db: Db,
  replyId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.findingReplies)
    .where(eq(t.findingReplies.id, replyId))
    .returning({ id: t.findingReplies.id });
  return rows.length > 0;
}
