import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  PrMeta,
  PrDetail,
  VcsClient,
  PrReviewComment,
  SmartDiff,
} from "@devdigest/shared";
import { PrCommentInput } from "@devdigest/shared";
import * as t from "../../db/schema.js";
import { getContext } from "../_shared/context.js";
import { IdParams } from "../_shared/schemas.js";
import { AppError, NotFoundError } from "../../platform/errors.js";
import { tryLoadLocalDiff } from "../_shared/diff/diff-loader.js";
import { splitUnifiedDiffByFile } from "../_shared/diff/split-by-file.js";
import {
  deriveReviewStatus,
  rollupSeverities,
  type SeverityCounts,
} from "./status.js";
import { PullsService } from "./service.js";

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const pullsService = new PullsService(container.reviewRepo);

  app.get(
    "/repos/:id/pulls",
    { schema: { params: IdParams } },
    async (req): Promise<PrMeta[]> => {
      const { workspaceId } = await getContext(container, req);
      const [repo] = await container.db
        .select()
        .from(t.repos)
        .where(
          and(
            eq(t.repos.workspaceId, workspaceId),
            eq(t.repos.id, req.params.id),
          ),
        );
      if (!repo) throw new NotFoundError("Repo not found");

      let gh: VcsClient | null = null;
      try {
        gh = await container.vcs(repo);
      } catch (err) {
        app.log.warn(
          { err },
          "GitHub client unavailable (no token / offline); serving persisted PRs",
        );
      }

      // Local-first: sync from GitHub when a token is configured, but never
      // fail the read — already-imported/seeded PRs stay viewable offline.
      if (gh) {
        try {
          const pulls = await gh.listPullRequests({
            owner: repo.owner,
            name: repo.name,
            project: repo.project ?? undefined,
            baseUrl: repo.baseUrl ?? undefined,
          });
          for (const pr of pulls) {
            await container.db
              .insert(t.pullRequests)
              .values({
                workspaceId,
                repoId: repo.id,
                number: pr.number,
                title: pr.title,
                author: pr.author,
                branch: pr.branch,
                base: pr.base,
                headSha: pr.head_sha,
                additions: pr.additions,
                deletions: pr.deletions,
                filesCount: pr.files_count,
                status: pr.status,
                openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              })
              .onConflictDoUpdate({
                target: [t.pullRequests.repoId, t.pullRequests.number],
                set: {
                  title: pr.title,
                  headSha: pr.head_sha,
                  status: pr.status,
                  updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
                },
              });
          }
        } catch (err) {
          app.log.warn(
            { err },
            "GitHub PR sync skipped (no token / offline); serving persisted PRs",
          );
        }
      }

      const rows = await container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.repoId, repo.id));

      // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
      // land with zeroed size/diff. Backfill them once from the detail endpoint
      // so the list shows real S/M/L + ± counts. Capped per request (each backfill
      // is a detail fetch) — the periodic refetch chips away at any remainder.
      const BACKFILL_LIMIT = 10;
      if (gh) {
        const needStats = rows
          .filter(
            (r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0,
          )
          .slice(0, BACKFILL_LIMIT);
        for (const r of needStats) {
          try {
            const detail = await gh.getPullRequest(
              {
                owner: repo.owner,
                name: repo.name,
                project: repo.project ?? undefined,
                baseUrl: repo.baseUrl ?? undefined,
              },
              r.number,
            );
            await container.db
              .update(t.pullRequests)
              .set({
                additions: detail.additions,
                deletions: detail.deletions,
                filesCount: detail.files_count,
              })
              .where(eq(t.pullRequests.id, r.id));
            r.additions = detail.additions;
            r.deletions = detail.deletions;
            r.filesCount = detail.files_count;
          } catch (err) {
            app.log.warn(
              { err, number: r.number },
              "PR diff-stat backfill skipped",
            );
          }
        }
      }

      // Latest-review rollup per PR (score + findings severity counts), so the
      // list can show a SCORE ring and FINDINGS breakdown. Computed on read from
      // reviews/findings (no FK denorm); the list is small, so two IN-queries +
      // JS grouping is cheap.
      const prIds = rows.map((r) => r.id);
      const latestReviewByPr = new Map<
        string,
        { id: string; score: number | null }
      >();
      const sevByReview = new Map<string, SeverityCounts>();
      // Total accumulated cost across all agent runs per PR — SUM so errored runs
      // (cost_usd = null) don't zero out the column when they happen to be the latest run.
      const lastRunCostByPr = new Map<string, number | null>();
      if (prIds.length > 0) {
        const runRows = await container.db
          .select({
            prId: t.agentRuns.prId,
            costUsd: sql<number | null>`sum(${t.agentRuns.costUsd})`,
          })
          .from(t.agentRuns)
          .where(
            and(
              eq(t.agentRuns.workspaceId, workspaceId),
              inArray(t.agentRuns.prId, prIds),
            ),
          )
          .groupBy(t.agentRuns.prId);
        for (const row of runRows) {
          if (row.prId) lastRunCostByPr.set(row.prId, row.costUsd ?? null);
        }
      }
      if (prIds.length > 0) {
        const reviewRows = await container.db
          .select({
            id: t.reviews.id,
            prId: t.reviews.prId,
            score: t.reviews.score,
          })
          .from(t.reviews)
          .where(
            and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, "review")),
          )
          .orderBy(desc(t.reviews.createdAt));
        // Rows are newest-first → first seen per PR is the latest review.
        for (const rv of reviewRows) {
          if (!latestReviewByPr.has(rv.prId))
            latestReviewByPr.set(rv.prId, { id: rv.id, score: rv.score });
        }
        const latestIds = [...latestReviewByPr.values()].map((v) => v.id);
        if (latestIds.length > 0) {
          const findingRows = await container.db
            .select({
              reviewId: t.findings.reviewId,
              severity: t.findings.severity,
            })
            .from(t.findings)
            .where(inArray(t.findings.reviewId, latestIds));
          const byReview = new Map<string, { severity: string }[]>();
          for (const f of findingRows) {
            const list = byReview.get(f.reviewId) ?? [];
            list.push({ severity: f.severity });
            byReview.set(f.reviewId, list);
          }
          for (const [reviewId, fs] of byReview)
            sevByReview.set(reviewId, rollupSeverities(fs));
        }
      }

      const now = Date.now();
      return rows.map((r) => {
        const review = latestReviewByPr.get(r.id);
        const sev = review ? sevByReview.get(review.id) : undefined;
        return {
          id: r.id,
          number: r.number,
          title: r.title,
          author: r.author,
          branch: r.branch,
          base: r.base,
          head_sha: r.headSha,
          additions: r.additions,
          deletions: r.deletions,
          files_count: r.filesCount,
          status: deriveReviewStatus({
            ghStatus: r.status,
            lastReviewedSha: r.lastReviewedSha,
            headSha: r.headSha,
            updatedAt: r.updatedAt,
            now,
          }),
          opened_at: r.openedAt?.toISOString() ?? null,
          updated_at: r.updatedAt?.toISOString() ?? null,
          score: review ? review.score : null,
          findings_critical: review ? (sev?.critical ?? 0) : null,
          findings_warning: review ? (sev?.warning ?? 0) : null,
          findings_suggestion: review ? (sev?.suggestion ?? 0) : null,
          last_run_cost_usd: lastRunCostByPr.get(r.id) ?? null,
        };
      });
    },
  );

  app.get(
    "/pulls/:id",
    { schema: { params: IdParams } },
    async (req): Promise<PrDetail> => {
      const { workspaceId } = await getContext(container, req);
      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(
          and(
            eq(t.pullRequests.workspaceId, workspaceId),
            eq(t.pullRequests.id, req.params.id),
          ),
        );
      if (!pr) throw new NotFoundError("Pull request not found");
      const [repo] = await container.db
        .select()
        .from(t.repos)
        .where(eq(t.repos.id, pr.repoId));
      if (!repo) throw new NotFoundError("Repo not found");

      // Local-first: refresh detail from the provider when a token is
      // configured; otherwise serve the persisted files/commits/body (seeded
      // or previously imported) so PR detail works offline.
      try {
        const gh = await container.vcs(repo);
        const providerDetail = await gh.getPullRequest(
          {
            owner: repo.owner,
            name: repo.name,
            project: repo.project ?? undefined,
            baseUrl: repo.baseUrl ?? undefined,
          },
          pr.number,
        );

        // TASK-007 (R25) — diff-first: overlay each provider-reported file's
        // `patch` (and additions/deletions) with the LOCAL `git diff`'s
        // version when available. The provider's FILE LIST stays
        // authoritative — NOT replaced by the local diff's file list.
        // Empirically confirmed against a real multi-iteration ADO PR (org
        // GES-IT PR #6327, 9 iterations): a naive two-dot `git diff
        // base^1..base^2` reports 134 files because it also picks up the
        // target branch's own unrelated churn since the PR's branch point,
        // while ADO's `iterations/{id}/changes` and the correct three-dot
        // `git diff base...head` (this loader's actual `diffRefsFor` — merge-
        // base semantics, same as the GitHub path) both agree on the TRUE
        // 7-file PR diff. Trusting the local diff's file list as
        // authoritative would have silently INFLATED the Files-changed tab
        // with unrelated files — the provider's list was correct all along;
        // the only real defect was ADO's `item.path` carrying a leading `/`
        // that `git diff`'s `+++ b/path` line never has, which prevented ANY
        // overlay match (fixed in `mappers.ts#stripLeadingSlash`).
        const local = await tryLoadLocalDiff(container, repo, {
          number: pr.number,
          base: providerDetail.base,
          headSha: providerDetail.head_sha,
        });
        const splitPatches = local.diff ? splitUnifiedDiffByFile(local.diff.raw) : null;
        const localFilesByPath = new Map((local.diff?.files ?? []).map((f) => [f.path, f]));

        const files = providerDetail.files.map((f) => {
          const splitPatch = splitPatches?.get(f.path);
          if (splitPatch == null) return f;
          const localFile = localFilesByPath.get(f.path);
          return {
            path: f.path,
            patch: splitPatch,
            additions: localFile?.additions ?? f.additions,
            deletions: localFile?.deletions ?? f.deletions,
          };
        });
        const anyPatchMissing = files.some((f) => !f.patch);
        const diffUnavailable =
          anyPatchMissing && local.unavailableReason
            ? { reason: local.unavailableReason }
            : undefined;

        const detail: PrDetail = {
          ...providerDetail,
          files,
          files_count: files.length,
          additions: files.reduce((sum, f) => sum + f.additions, 0),
          deletions: files.reduce((sum, f) => sum + f.deletions, 0),
          diff_unavailable: diffUnavailable,
        };

        await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
        if (detail.files.length > 0) {
          await container.db.insert(t.prFiles).values(
            detail.files.map((f) => ({
              prId: pr.id,
              path: f.path,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch ?? null,
            })),
          );
        }
        await container.db
          .delete(t.prCommits)
          .where(eq(t.prCommits.prId, pr.id));
        if (detail.commits.length > 0) {
          await container.db.insert(t.prCommits).values(
            detail.commits.map((c) => ({
              prId: pr.id,
              sha: c.sha,
              message: c.message,
              author: c.author,
              committedAt: c.committed_at ? new Date(c.committed_at) : null,
            })),
          );
        }
        await container.db
          .update(t.pullRequests)
          .set({
            body: detail.body ?? null,
            // Diff stats aren't on GitHub's PR-list payload — backfill them from
            // the detail fetch so the Pull Requests list shows real size/files.
            additions: detail.additions,
            deletions: detail.deletions,
            filesCount: detail.files_count,
          })
          .where(eq(t.pullRequests.id, pr.id));

        return { ...detail, id: pr.id };
      } catch (err) {
        app.log.warn(
          { err },
          "GitHub PR detail refresh skipped (no token / offline); serving persisted detail",
        );
        const files = await container.db
          .select()
          .from(t.prFiles)
          .where(eq(t.prFiles.prId, pr.id));
        const commits = await container.db
          .select()
          .from(t.prCommits)
          .where(eq(t.prCommits.prId, pr.id));
        return {
          id: pr.id,
          number: pr.number,
          title: pr.title,
          author: pr.author,
          branch: pr.branch,
          base: pr.base,
          head_sha: pr.headSha,
          additions: pr.additions,
          deletions: pr.deletions,
          files_count: pr.filesCount,
          status: pr.status as PrDetail["status"],
          opened_at: pr.openedAt?.toISOString() ?? null,
          updated_at: pr.updatedAt?.toISOString() ?? null,
          body: pr.body ?? null,
          files: files.map((f) => ({
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
          commits: commits.map((c) => ({
            sha: c.sha,
            message: c.message,
            author: c.author,
            committed_at: c.committedAt?.toISOString() ?? null,
          })),
        };
      }
    },
  );

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  async function resolvePrAndRepo(id: string, workspaceId: string) {
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.id, id),
        ),
      );
    if (!pr) throw new NotFoundError("Pull request not found");
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError("Repo not found");
    return { pr, repo };
  }

  app.get(
    "/pulls/:id/comments",
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      let gh: VcsClient;
      try {
        gh = await container.vcs(repo);
      } catch (err) {
        app.log.warn(
          { err },
          "GitHub client unavailable; serving no PR comments",
        );
        return [];
      }
      try {
        return await gh.listReviewComments(
          {
            owner: repo.owner,
            name: repo.name,
            project: repo.project ?? undefined,
            baseUrl: repo.baseUrl ?? undefined,
          },
          pr.number,
        );
      } catch (err) {
        app.log.warn(
          { err },
          "GitHub review-comments fetch skipped (offline / error)",
        );
        return [];
      }
    },
  );

  app.post(
    "/pulls/:id/comments",
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      const input = req.body;
      let gh: VcsClient;
      try {
        gh = await container.vcs(repo);
      } catch {
        throw new AppError(
          "vcs_unavailable",
          repo.vcsProvider === "azure-devops"
            ? "Connect an Azure DevOps token to post comments."
            : "Connect a GitHub token to post comments.",
          400,
        );
      }
      try {
        // TASK-008 (SPEC-2026-08-25-azure-devops-integration, Q1):
        // `publishComment` is the one entrypoint both providers implement —
        // GitHub's inline-comment path and Azure DevOps' idempotent-thread
        // path both live behind it. `createReviewComment` still exists on
        // the port for callers that specifically want a NON-idempotent
        // create, but this route always wants "publish this finding", so it
        // calls the shared entrypoint directly rather than picking a
        // provider-specific method here.
        return await gh.publishComment(
          {
            owner: repo.owner,
            name: repo.name,
            project: repo.project ?? undefined,
            baseUrl: repo.baseUrl ?? undefined,
          },
          pr.number,
          {
            commitId: pr.headSha,
            path: input.path,
            line: input.line,
            ...(input.side ? { side: input.side } : {}),
            body: input.body,
            ...(input.in_reply_to != null
              ? { inReplyTo: input.in_reply_to }
              : {}),
          },
        );
      } catch (err) {
        // GitHub rejects comments on lines outside the diff / on closed PRs
        // (422); Azure DevOps rejects non-English bodies (ValidationError,
        // see adapters/azure-devops/threads.ts) and various thread-shape
        // errors. Either way the provider's own message is the useful part.
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to post the comment.";
        throw new AppError("comment_publish_failed", msg, 400, {
          cause: String(err),
        });
      }
    },
  );

  // ---- Smart Diff ---------------------------------------------------------

  app.get(
    "/pulls/:id/smart-diff",
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiff> => {
      const { workspaceId } = await getContext(container, req);
      return pullsService.buildSmartDiff(workspaceId, req.params.id);
    },
  );
}
