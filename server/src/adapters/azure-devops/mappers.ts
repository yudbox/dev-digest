import type * as GitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { PrMeta, PrDetail, PrFile, PrStatus, PrCommit } from "@devdigest/shared";

/**
 * TASK-006 — pure ADO → DTO mapping functions. No network calls; tested
 * table-driven against the real-response fixture captured in TASK-000
 * (`__fixtures__/pr-6327-iteration-changes-shape.json`).
 *
 * CRITICAL, empirically-confirmed divergence from the plan's own AC-19 prose
 * (`server/insights/INSIGHTS.md:142`, SPIKE-NOTES.md §2d): the
 * `azure-devops-node-api` SDK (unlike the raw REST JSON for the SAME field)
 * returns `status`/`changeType`/`commentType` as NUMERIC enums, not strings.
 * Every mapper below compares against `GitInterfaces`' numeric enum
 * constants — never a string literal like `'active'`.
 */

/** `refs/heads/main` → `main`. Leaves already-bare names (or `undefined`) unchanged. */
export function stripRefsHeadsPrefix(ref: string | undefined): string {
  if (!ref) return "";
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/**
 * `GitInterfaces.PullRequestStatus` (numeric) → DevDigest's `PrStatus`.
 * `NotSet` (0) is not a real lifecycle state the REST API returns for an
 * actual PR — mapped to `open` defensively rather than throwing, since a
 * missing/zero status must never crash a list render.
 */
export function mapPullRequestStatus(
  status: GitInterfaces.PullRequestStatus | undefined,
): PrStatus {
  switch (status) {
    case 3 /* Completed */:
      return "merged";
    case 2 /* Abandoned */:
      return "closed";
    case 1 /* Active */:
    default:
      return "open";
  }
}

function toIsoOrNull(value: Date | string | undefined | null): string | null {
  if (!value) return null;
  // The SDK's declared type is `Date`, but (per TASK-000's spike caution
  // about trusting declared vs. actual wire shapes) defensively accept a
  // pass-through ISO string too, in case a given SDK version / self-hosted
  // ADO Server variant doesn't deserialize date fields into real `Date`
  // instances.
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * ADO's `item.path` (from `iterations/{id}/changes`) is repo-root-relative
 * WITH a leading slash (e.g. `/apps/order-functions/src/foo.ts`) — confirmed
 * against the real API (PR #6327). `git diff`'s `+++ b/path` line (what
 * `splitUnifiedDiffByFile` keys its map by) has NO leading slash. Without
 * stripping it here, TASK-007's by-path patch overlay in `pulls/routes.ts`
 * would silently fail to match ANY file (leading-slash path never equals the
 * same path without one), leaving every file's `patch` null even when a
 * perfectly good local diff was computed — caught only by a real end-to-end
 * HTTP test against the live PR, not by mock/fixture-based unit tests.
 */
function stripLeadingSlash(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

function authorDisplayName(
  identity: GitInterfaces.GitPullRequest["createdBy"],
): string {
  return identity?.displayName ?? identity?.uniqueName ?? "unknown";
}

/** `listPullRequests` mapping — `additions`/`deletions`/`files_count` are
 * always 0 here (R20/AC-006-2): ADO's list payload carries no diff stats;
 * `getPullRequest` backfills them (via TASK-007's diff overlay). */
export function mapPullRequestToMeta(pr: GitInterfaces.GitPullRequest): PrMeta {
  return {
    number: pr.pullRequestId ?? 0,
    title: pr.title ?? "",
    author: authorDisplayName(pr.createdBy),
    branch: stripRefsHeadsPrefix(pr.sourceRefName),
    base: stripRefsHeadsPrefix(pr.targetRefName),
    head_sha: pr.lastMergeSourceCommit?.commitId ?? "",
    additions: 0,
    deletions: 0,
    files_count: 0,
    status: mapPullRequestStatus(pr.status),
    opened_at: toIsoOrNull(pr.creationDate),
    updated_at: toIsoOrNull(pr.closedDate) ?? toIsoOrNull(pr.creationDate),
  };
}

/** One `iterations/{id}/changes` entry, mapped to a PrFile-shaped stub —
 * `patch` is `null` on this task (TASK-007 fills it from the local diff);
 * `changeTrackingId` is carried alongside for TASK-008's thread positioning
 * (R38) even though `PrFile` itself has no such field. */
export interface MappedChangeEntry extends PrFile {
  changeTrackingId: number | undefined;
  /** `VersionControlChangeType` bitflag — kept for callers that need to skip
   * e.g. pure deletes when computing stats. Numeric, per TASK-000's finding. */
  changeType: GitInterfaces.VersionControlChangeType | undefined;
}

export function mapChangeEntryToFile(
  entry: GitInterfaces.GitPullRequestChange,
): MappedChangeEntry {
  return {
    path: stripLeadingSlash(entry.item?.path ?? ""),
    additions: 0,
    deletions: 0,
    patch: null,
    changeTrackingId: entry.changeTrackingId,
    changeType: entry.changeType,
  };
}

export function mapCommit(commit: GitInterfaces.GitCommitRef): PrCommit {
  return {
    sha: commit.commitId ?? "",
    message: commit.comment ?? "",
    author: commit.author?.name ?? commit.committer?.name ?? "unknown",
    committed_at: toIsoOrNull(commit.author?.date ?? commit.committer?.date),
  };
}

/**
 * `getPullRequest` mapping. `files`/`commits` are supplied separately by the
 * client (fetched via distinct SDK calls) rather than derived here, since
 * `GitPullRequest` itself carries neither. `linked_issue` is always omitted —
 * ADO Work Items are out of scope (R23); the `Closes #N` GitHub convention
 * has no ADO equivalent worth guessing at.
 */
export function mapPullRequestToDetail(
  pr: GitInterfaces.GitPullRequest,
  files: MappedChangeEntry[],
  commits: PrDetail["commits"],
): PrDetail {
  const meta = mapPullRequestToMeta(pr);
  return {
    ...meta,
    body: pr.description ?? null,
    files: files.map(({ path, additions, deletions, patch }) => ({
      path,
      additions,
      deletions,
      patch,
    })),
    files_count: files.length,
    commits,
    linked_issue: undefined,
  };
}
