import { AppError } from "../../platform/errors.js";
import type { VcsProvider } from "@devdigest/shared";

/**
 * TASK-006 — shared constants for the Azure DevOps `VcsClient` adapter.
 * Retry/backoff thresholds are deliberately NOT here yet — those are
 * TASK-009's `retry.ts` (ADO-specific `isRetryable` layered on top of the
 * existing `platform/resilience.ts#withRetry`, not a fork).
 */

/** Default Azure DevOps Cloud hosting base URL, used when `repo.baseUrl` is
 * unset (should not normally happen for a persisted azure-devops repo — the
 * add-repo flow requires `base_url` — but this keeps the adapter defensive). */
export const AZURE_DEVOPS_DEFAULT_BASE_URL = "https://dev.azure.com";

/** `iterations/{id}/changes` page size — ADO's documented maximum. */
export const MAX_ITERATION_CHANGES_PAGE = 2000;

/**
 * A method on `VcsClient` that Azure DevOps has no analogue for (Work Items,
 * GitHub Actions-only CI, Git Data API commits, etc.) throws this — never a
 * silent empty success (per `VcsClient`'s own port docstring).
 */
export function notSupported(provider: VcsProvider, method: string): AppError {
  return new AppError(
    "not_supported",
    `${provider} does not support ${method}`,
    501,
  );
}

/**
 * TASK-009 (R-C) — retry thresholds for `retry.ts#withAdoRetry`. `retries: 3`
 * matches `platform/resilience.ts#withRetry`'s own default (kept explicit
 * here so it reads as an ADO-specific decision, not an accident of the
 * shared default). Base/max chosen so that even the worst case (3 retries)
 * stays a few seconds, well under the ≤60s budget (AC-009-1) — the actual
 * `Retry-After` value ADO returns is logged (see errors.ts#logAdoRateLimit)
 * but cannot drive `withRetry`'s per-attempt delay without forking it (R46).
 */
export const ADO_RETRY_MAX_ATTEMPTS = 3;
export const ADO_RETRY_BASE_DELAY_MS = 500;
export const ADO_RETRY_MAX_DELAY_MS = 4000;

/** PAT scopes required for the read + comment-publish paths this adapter
 * uses (R47) — surfaced in the `vcs_unauthorized` hint, not enforced. */
export const ADO_REQUIRED_PAT_SCOPES = [
  "vso.code",
  "vso.code_write",
  "vso.threads_full",
] as const;
