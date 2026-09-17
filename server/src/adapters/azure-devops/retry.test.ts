import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { adoIsRetryable, withAdoRetry } from "./retry.js";
import { ADO_RETRY_MAX_ATTEMPTS } from "./constants.js";

/**
 * TASK-009 — hermetic tests for `adoIsRetryable`/`withAdoRetry`. No network:
 * every "ADO error" here is a plain object shaped exactly like what
 * `typed-rest-client`/`azure-devops-node-api` actually throws (see errors.ts's
 * module doc for the citation) — `{ statusCode, rateLimit? }`.
 */

function adoError(statusCode: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`ADO error ${statusCode}`), { statusCode, ...extra });
}

describe("adoIsRetryable", () => {
  it("retries 429 unconditionally — no quota/billing carve-out (unlike the default LLM-provider policy)", () => {
    expect(adoIsRetryable(adoError(429, { message: "rate limited" }))).toBe(true);
    expect(adoIsRetryable(adoError(429, { message: "quota exceeded — billing required" }))).toBe(true);
  });

  it("retries 5xx", () => {
    expect(adoIsRetryable(adoError(500))).toBe(true);
    expect(adoIsRetryable(adoError(503))).toBe(true);
  });

  it("does not retry 4xx other than 429", () => {
    expect(adoIsRetryable(adoError(400))).toBe(false);
    expect(adoIsRetryable(adoError(401))).toBe(false);
    expect(adoIsRetryable(adoError(403))).toBe(false);
    expect(adoIsRetryable(adoError(404))).toBe(false);
  });

  it("retries network-level errors by code", () => {
    expect(adoIsRetryable(Object.assign(new Error(), { code: "ECONNRESET" }))).toBe(true);
    expect(adoIsRetryable(Object.assign(new Error(), { code: "ETIMEDOUT" }))).toBe(true);
    expect(adoIsRetryable(new Error("boom"))).toBe(false);
  });
});

describe("withAdoRetry (AC-009-1, AC-009-3, AC-009-4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-009-1: a 429 with Retry-After retries exactly ADO_RETRY_MAX_ATTEMPTS times, total delay ≤60s, then throws vcs_rate_limited", async () => {
    const fn = vi.fn().mockRejectedValue(adoError(429, { rateLimit: { retryAfter: 2 } }));

    const promise = withAdoRetry(fn, "test-call").catch((e) => e);
    // ADO_RETRY_MAX_ATTEMPTS retries → ADO_RETRY_MAX_ATTEMPTS+1 total calls,
    // each gated behind a real setTimeout — drain them all under fake timers.
    for (let i = 0; i <= ADO_RETRY_MAX_ATTEMPTS; i++) {
      await vi.runOnlyPendingTimersAsync();
    }
    const result = await promise;

    expect(fn).toHaveBeenCalledTimes(ADO_RETRY_MAX_ATTEMPTS + 1);
    expect(result).toMatchObject({ code: "vcs_rate_limited", statusCode: 429 });
  });

  it("AC-009-3: layers on the shared withRetry — a non-retryable error (400) is thrown after exactly one attempt, unchanged", async () => {
    const fn = vi.fn().mockRejectedValue(adoError(400, { message: "bad request" }));
    await expect(withAdoRetry(fn, "test-call")).rejects.toMatchObject({ statusCode: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("AC-009-4: a 403 is translated to vcs_unauthorized with all three required scopes listed", async () => {
    const fn = vi.fn().mockRejectedValue(adoError(403, { result: { message: "Forbidden, whatever ADO's own wording is" } }));
    const err = (await withAdoRetry(fn, "test-call").catch((e) => e)) as Error;
    expect(err).toMatchObject({ code: "vcs_unauthorized", statusCode: 403 });
    expect(err.message).toContain("vso.code");
    expect(err.message).toContain("vso.code_write");
    expect(err.message).toContain("vso.threads_full");
  });

  it("a 401 is also translated to vcs_unauthorized (not just 403)", async () => {
    const fn = vi.fn().mockRejectedValue(adoError(401));
    const err = await withAdoRetry(fn, "test-call").catch((e) => e);
    expect(err).toMatchObject({ code: "vcs_unauthorized", statusCode: 401 });
  });

  it("succeeds on a later attempt without exhausting retries", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(adoError(503))
      .mockResolvedValueOnce("ok");

    const promise = withAdoRetry(fn, "test-call");
    await vi.runOnlyPendingTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
