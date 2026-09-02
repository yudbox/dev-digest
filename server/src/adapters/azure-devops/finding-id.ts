import { createHash } from "node:crypto";

/**
 * TASK-008 (SPEC-2026-08-25-azure-devops-integration, R32/R33): a stable
 * identity for one published finding, used to make Azure DevOps thread
 * publishing idempotent. threads.ts looks up an existing thread by matching
 * properties['devdigest.findingId'] against this hash - the same finding
 * (same repo, PR, file:line, severity, title) always hashes to the same id
 * across processes and across retries, so re-publishing updates the existing
 * thread instead of creating a duplicate (R33).
 *
 * Deliberately hashes on (repo, pr, path, line, severity, title) - NOT on
 * body and NOT on the head commit SHA:
 *   - body is exactly the text expected to vary when a finding is
 *     re-generated (wording tweaks, LLM re-run) - hashing it would defeat
 *     idempotency the moment the message changes even slightly.
 *   - The commit SHA changes on every push; excluding it is what lets a
 *     comment stay matched to "the same finding" across PR iterations (R38 -
 *     positioning still moves via pullRequestThreadContext, but the THREAD
 *     IDENTITY itself does not depend on which commit is current).
 * Any change to severity or title (a materially different finding, not just
 * a reworded one) intentionally produces a different id, per R32's rule that
 * changing any attribute must change the hash.
 */
export interface FindingIdentity {
  repoOwner: string;
  repoProject: string | undefined;
  repoName: string;
  prNumber: number;
  path: string;
  line: number;
  severity: string;
  title: string;
}

function findingKey(identity: FindingIdentity): string {
  const parts = [
    identity.repoOwner,
    identity.repoProject ?? "",
    identity.repoName,
    String(identity.prNumber),
    identity.path,
    String(identity.line),
    identity.severity,
    identity.title,
  ];
  return parts.join("\x00");
}

export function findingId(identity: FindingIdentity): string {
  return createHash("sha256").update(findingKey(identity), "utf8").digest("hex");
}
