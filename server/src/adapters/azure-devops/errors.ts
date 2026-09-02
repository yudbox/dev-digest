import { AppError } from "../../platform/errors.js";
import { ADO_REQUIRED_PAT_SCOPES } from "./constants.js";

/**
 * TASK-009 — defensive parsing of Azure DevOps' real (non-GitHub-shaped)
 * error surface. Confirmed by reading `azure-devops-node-api`'s own source
 * (not guessed): every ADO REST failure raised by the SDK is a plain `Error`
 * with `.statusCode` (number), `.result` (parsed JSON body, when the body IS
 * valid JSON) and `.responseHeaders` (raw response headers) attached by
 * `typed-rest-client/RestClient#processResponse`
 * (node_modules/typed-rest-client/RestClient.js:191-206). The SDK's own
 * `AdoRestClient` wrapper additionally attaches `.rateLimit` — parsed
 * `x-ratelimit-*`/`retry-after` headers — to the thrown error on every
 * request, success or failure (node_modules/azure-devops-node-api/
 * RateLimitUtils.js + AdoHttpClientBases.js).
 */
interface AdoRestError {
  statusCode?: number;
  message?: string;
  result?: { typeKey?: string; message?: string } | null;
  responseHeaders?: Record<string, string | string[] | undefined>;
  rateLimit?: {
    resource?: string;
    delay?: number;
    limit?: number;
    remaining?: number;
    reset?: number;
    retryAfter?: number;
  };
}

function asAdoError(err: unknown): AdoRestError {
  return (err ?? {}) as AdoRestError;
}

export function adoStatusCode(err: unknown): number | undefined {
  const status = asAdoError(err).statusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * R47 — 401/403 → `vcs_unauthorized`, with a scope hint. Deliberately does
 * NOT pattern-match on `err.message`/`err.result.message` text (ADO's wording
 * varies by hosting type and locale) — the numeric statusCode is the only
 * stable signal.
 */
export function mapAdoAuthError(err: unknown): AppError | undefined {
  const status = adoStatusCode(err);
  if (status !== 401 && status !== 403) return undefined;
  return new AppError(
    "vcs_unauthorized",
    `Azure DevOps rejected the request (HTTP ${status}). Verify the configured ` +
      `Personal Access Token is valid and has these scopes: ${ADO_REQUIRED_PAT_SCOPES.join(", ")}.`,
    status,
  );
}

/** R44 — a 429 that survived every retry. */
export function adoRateLimitedError(): AppError {
  return new AppError(
    "vcs_rate_limited",
    "Azure DevOps rate-limited the request and retries were exhausted.",
    429,
  );
}

/**
 * R48 — ADO occasionally answers an unauthenticated/misconfigured request
 * with a 2xx (observed: 203) whose BODY is an HTML sign-in page, not JSON.
 * `typed-rest-client`'s RestClient only branches on the status code to
 * decide success vs. failure (RestClient.js:154-163,191) — a 2xx with
 * unparsable JSON silently resolves with `result: null`
 * (RestClient.js:167-186), which the SDK's collection-shaped methods (e.g.
 * `getPullRequests`) then deserialize into an EMPTY ARRAY, not an error.
 * There is no way to catch this from inside a typed `IGitApi` method call —
 * by the time it returns, the content-type is gone. This guard runs on the
 * RAW response of a one-time preflight request instead (see client.ts's
 * `verifyAdoConnection`), before any typed SDK call is trusted.
 */
export function assertJsonResponse(
  statusCode: number,
  contentType: string | null | undefined,
): void {
  if (statusCode >= 300) return; // real error status — the normal SDK error path handles this
  if (contentType?.toLowerCase().includes("application/json")) return;
  throw new AppError(
    "vcs_unauthorized",
    `Azure DevOps returned a non-JSON response (HTTP ${statusCode}, content-type ` +
      `"${contentType ?? "unknown"}") — this is how it signals an expired session or ` +
      `invalid PAT instead of a clean 401. Verify the configured Personal Access Token.`,
    401,
  );
}

/** R45 — safe-to-log rate-limit snapshot. Never logs headers wholesale (would
 * risk leaking `Authorization`) or any part of the request — only the three
 * numeric fields ADO exposes for this purpose. */
export function adoRateLimitSnapshot(
  err: unknown,
): { remaining?: number; delaySeconds?: number; limit?: number } | undefined {
  const rl = asAdoError(err).rateLimit;
  if (!rl) return undefined;
  return { remaining: rl.remaining, delaySeconds: rl.delay ?? rl.retryAfter, limit: rl.limit };
}

export function logAdoRateLimit(err: unknown, context: string): void {
  const snapshot = adoRateLimitSnapshot(err);
  if (!snapshot) return;
  // Adapters have no injected logger today (see server/insights/INSIGHTS.md);
  // console.warn mirrors app.ts's own readiness-check-failure logging and is
  // confirmed PAT-free (snapshot is built from three whitelisted numbers).
  console.warn(`[azure-devops] rate-limit signal during ${context}:`, snapshot);
}
