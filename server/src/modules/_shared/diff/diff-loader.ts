import type { Container } from "../../../platform/container.js";
import type { UnifiedDiff, VcsProvider, DiffUnavailableReason } from "@devdigest/shared";
import { parseUnifiedDiff } from "../../../adapters/git/diff-parser.js";
import * as schema from "../../../db/schema.js";
import type { PullRow } from "../../../db/rows.js";
import { buildCloneUrl, withVcsToken } from "../../repos/helpers.js";

/**
 * TASK-007 (R-B) — diff-first loader, extracted from `reviews/diff-loader.ts`
 * so both `reviews` (the review pipeline) and `pulls` (the detail route) can
 * depend on ONE shared implementation instead of `pulls` reaching across
 * module boundaries into `reviews/diff-loader.ts` directly (Architecture
 * Notes: "pulls не имеет права импортировать reviews/diff-loader.ts
 * напрямую"). `reviews/diff-loader.ts` now re-exports `loadDiff`/
 * `diffFromPrFiles` from here, unchanged, so no call site in `reviews`
 * needed to change.
 *
 * `repo.ts`'s import of `buildCloneUrl`/`withVcsToken` (pure, side-effect-free
 * URL builders from `modules/repos/helpers.ts`) is a deliberate, narrow
 * exception to "modules communicate only through their service layer" — see
 * `server/insights/INSIGHTS.md` (2026-08-27, TASK-007 session) for the
 * reasoning: duplicating these two pure functions would create two sources
 * of truth for ADO's PAT-embedding URL convention, which is worse than a
 * documented cross-module import of a stateless helper.
 */

type RepoRow = typeof schema.repos.$inferSelect;
/** Minimal structural shape needed to reconstruct a diff from persisted
 * `pr_files` — deliberately NOT `ReviewRepository` (a `reviews`-module type),
 * so this shared file has no dependency on any feature module's repository. */
interface PrFilesReader {
  getPrFiles(prId: string): Promise<(typeof schema.prFiles.$inferSelect)[]>;
}

/** Build the provider-aware `RepoRef` (+`provider` discriminator) `GitClient`
 * needs for path resolution (`clonePathFor`) and refspec dispatch. */
function buildRepoRef(repoRow: RepoRow) {
  return {
    owner: repoRow.owner,
    name: repoRow.name,
    project: repoRow.project ?? undefined,
    baseUrl: repoRow.baseUrl ?? undefined,
    provider: repoRow.vcsProvider as VcsProvider,
  };
}

/**
 * Ensure the PR's head (and, for Azure DevOps, base — bundled for free in the
 * same fetch, per TASK-000's spike) commit is present in the local clone
 * before diffing (R26). GitHub needs no authenticated URL (`origin` already
 * carries the token from the original clone); Azure DevOps' `origin` never
 * carries credentials (AC-005-1), so an authenticated URL is rebuilt here
 * from the persisted repo identity + the current `AZURE_DEVOPS_TOKEN`.
 *
 * Returns the REAL, just-fetched PR head sha — the caller must diff/label
 * against this, never against `pull.headSha` read back from the DB. That
 * field is only refreshed when `GET /repos/:id/pulls` runs (opening/
 * reloading the PR list), not before every review — so a review triggered
 * right after a fresh push, without an intervening list reload, would
 * otherwise silently diff (GitHub) or mislabel "reviewed at" (both
 * providers) against the PR's PREVIOUS head. Confirmed live 2026-09-02 on a
 * real Azure DevOps PR whose head moved mid-session.
 */
async function ensurePullHeadFetched(
  container: Container,
  repoRow: RepoRow,
  prNumber: number,
): Promise<string> {
  const provider = repoRow.vcsProvider as VcsProvider;
  let url: string | undefined;
  if (provider === "azure-devops") {
    const token = await container.secrets.get("AZURE_DEVOPS_TOKEN");
    if (!token) throw new Error("AZURE_DEVOPS_TOKEN is not configured");
    const raw = buildCloneUrl({
      vcsProvider: provider,
      owner: repoRow.owner,
      name: repoRow.name,
      project: repoRow.project,
      baseUrl: repoRow.baseUrl,
    });
    url = withVcsToken(raw, provider, token);
  }
  return container.git.fetchPullHead(buildRepoRef(repoRow), prNumber, url);
}

/**
 * The base/head refs to diff between, once the head (and for ADO, base) are
 * locally fetched. `resolvedHeadSha` is `ensurePullHeadFetched`'s return
 * value on success, or `null` when that best-effort fetch failed (`loadDiff`
 * degrades rather than hard-failing) — in the `null` case GitHub falls back
 * to the persisted `pull.headSha` exactly as before this fix, so a fetch
 * failure never makes things WORSE than the pre-fix behavior, only "not yet
 * improved" for that one call.
 *
 * Azure DevOps: unaffected by `resolvedHeadSha` either way — `fetchPullHead`
 * lands the PR's auto-generated merge commit at local ref `pr-{n}`, whose two
 * parents are EXACTLY the target(base)/source(head) commits (TASK-000
 * spike); `pr-{n}^1`/`pr-{n}^2` are themselves always the freshest fetch,
 * more robust than trusting a same-named local branch ref since ADO's PR
 * target branch may not be the repo's checked-out default branch.
 */
function diffRefsFor(
  repoRow: RepoRow,
  pull: { number: number; base: string; headSha: string },
  resolvedHeadSha: string | null,
): {
  base: string;
  head: string;
} {
  if (repoRow.vcsProvider === "azure-devops") {
    return { base: `pr-${pull.number}^1`, head: `pr-${pull.number}^2` };
  }
  return { base: pull.base, head: resolvedHeadSha ?? pull.headSha };
}

function classifyGitError(err: unknown): DiffUnavailableReason {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /couldn't find remote ref|unknown revision|bad revision|not a valid object name|needed a single revision|no such file or directory/i.test(
      msg,
    )
  ) {
    return "commits_missing";
  }
  return "diff_failed";
}

/** `loadDiff`'s result: the diff itself, plus the REAL head sha it was
 * computed against (`null` only when the best-effort fetch failed and the
 * caller fell all the way back to persisted `pr_files` patches — there is no
 * "just fetched" sha to report in that case). Callers that record "reviewed
 * at commit X" (e.g. `markReviewed`) must use `resolvedHeadSha`, not
 * `pull.headSha` — see `ensurePullHeadFetched`'s doc comment for why. */
export interface LoadedDiff {
  diff: UnifiedDiff;
  resolvedHeadSha: string | null;
}

/**
 * Load the unified diff for a PR. Prefers a real `git diff base...head` (now
 * preceded by a best-effort `fetchPullHead` so the exact head commit is
 * guaranteed reachable — R26); falls back to assembling a synthetic unified
 * diff from the persisted pr_files patches (so the reviewer works even
 * before a clone completes / in tests).
 */
export async function loadDiff(
  container: Container,
  repo: PrFilesReader,
  workspaceId: string,
  pull: PullRow,
  repoRow: RepoRow,
): Promise<LoadedDiff> {
  let resolvedHeadSha: string | null = null;
  try {
    resolvedHeadSha = await ensurePullHeadFetched(container, repoRow, pull.number);
  } catch {
    /* best-effort — git.diff below fails naturally if truly unavailable */
  }
  try {
    const { base, head } = diffRefsFor(repoRow, pull, resolvedHeadSha);
    const diff = await container.git.diff(buildRepoRef(repoRow), base, head);
    if (diff.files.length > 0) return { diff, resolvedHeadSha };
  } catch {
    /* fall through to pr_files reconstruction */
  }
  return { diff: await diffFromPrFiles(repo, pull.id), resolvedHeadSha: null };
}

/** Reconstruct a UnifiedDiff from persisted pr_files patches. */
export async function diffFromPrFiles(repo: PrFilesReader, prId: string): Promise<UnifiedDiff> {
  const files = await repo.getPrFiles(prId);
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join("\n"));
}

export interface LocalDiffAttempt {
  diff: UnifiedDiff | null;
  unavailableReason: DiffUnavailableReason | null;
  /** The real fetched head sha the diff was computed against, or `null` on
   * failure (`unavailableReason` explains why). See `LoadedDiff`'s doc. */
  resolvedHeadSha: string | null;
}

/**
 * Diff-first attempt WITH explicit failure classification — used by the
 * `pulls` detail route, which (unlike the review pipeline's silent
 * `loadDiff` fallback) needs to surface `PrDetail.diff_unavailable.reason`
 * to the client (R27/Q4).
 *
 * `clone_in_progress` is a real `DiffUnavailableReason` value (Phase 1) but
 * is not distinguished here from `clone_missing` — detecting an in-flight
 * clone job would require reading the `jobs` table by `CLONE_JOB_KIND`,
 * which lives in `modules/repos/` (another feature module); deferred rather
 * than adding that cross-module reach for a reason code with no AC requiring
 * it to be reachable in this phase.
 */
export async function tryLoadLocalDiff(
  container: Container,
  repoRow: RepoRow,
  pull: { number: number; base: string; headSha: string },
): Promise<LocalDiffAttempt> {
  if (!repoRow.clonePath) return { diff: null, unavailableReason: "clone_missing", resolvedHeadSha: null };

  let resolvedHeadSha: string;
  try {
    resolvedHeadSha = await ensurePullHeadFetched(container, repoRow, pull.number);
  } catch (err) {
    return { diff: null, unavailableReason: classifyGitError(err), resolvedHeadSha: null };
  }

  try {
    const { base, head } = diffRefsFor(repoRow, pull, resolvedHeadSha);
    const diff = await container.git.diff(buildRepoRef(repoRow), base, head);
    if (diff.files.length === 0) return { diff: null, unavailableReason: "diff_failed", resolvedHeadSha: null };
    return { diff, unavailableReason: null, resolvedHeadSha };
  } catch (err) {
    return { diff: null, unavailableReason: classifyGitError(err), resolvedHeadSha: null };
  }
}
