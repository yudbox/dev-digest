import { withRetry } from "../../platform/resilience.js";
import {
  adoStatusCode,
  mapAdoAuthError,
  adoRateLimitedError,
  logAdoRateLimit,
} from "./errors.js";
import {
  ADO_RETRY_MAX_ATTEMPTS,
  ADO_RETRY_BASE_DELAY_MS,
  ADO_RETRY_MAX_DELAY_MS,
} from "./constants.js";

/**
 * TASK-009/R46 — ADO-specific retryability layered on top of the existing
 * `platform/resilience.ts#withRetry` (same function, a different
 * `isRetryable` — not a fork). `defaultIsRetryable` already reads
 * `err.statusCode`, which the real ADO SDK does set (see errors.ts's module
 * doc), so a plain 429/5xx would already retry under the default policy too.
 * `adoIsRetryable` exists for one deliberate difference: `defaultIsRetryable`
 * treats a 429 as non-retryable when its message mentions quota/billing (an
 * OpenAI/Anthropic-specific carve-out for LLM providers) — Azure DevOps has
 * no such distinction, every ADO 429 is a plain rate-limit and must always be
 * retried.
 */
export function adoIsRetryable(err: unknown): boolean {
  const status = adoStatusCode(err);
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }
  const code = (err as { code?: string })?.code;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND";
}

/**
 * Runs one Azure DevOps SDK call under the shared retry policy, then
 * translates whatever error survives into the domain taxonomy: 401/403 →
 * `vcs_unauthorized` (R47), a 429 that outlived every retry →
 * `vcs_rate_limited` (R44). Anything else is rethrown unchanged.
 *
 * `context` is a short label (method name, "connection check", etc.) used
 * only for the rate-limit log line — never interpolated into an error the
 * caller sees.
 */
export async function withAdoRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  try {
    return await withRetry(fn, {
      retries: ADO_RETRY_MAX_ATTEMPTS,
      baseDelayMs: ADO_RETRY_BASE_DELAY_MS,
      maxDelayMs: ADO_RETRY_MAX_DELAY_MS,
      isRetryable: adoIsRetryable,
      onRetry: (_attempt, err) => logAdoRateLimit(err, context),
    });
  } catch (err) {
    const authError = mapAdoAuthError(err);
    if (authError) throw authError;
    if (adoStatusCode(err) === 429) throw adoRateLimitedError();
    throw err;
  }
}
