import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapAdoAuthError,
  adoRateLimitedError,
  assertJsonResponse,
  adoRateLimitSnapshot,
  logAdoRateLimit,
} from "./errors.js";

describe("mapAdoAuthError (R47)", () => {
  it("maps 401/403 regardless of message wording", () => {
    expect(mapAdoAuthError({ statusCode: 401 })).toMatchObject({ code: "vcs_unauthorized", statusCode: 401 });
    expect(mapAdoAuthError({ statusCode: 403, message: "any random ADO wording" })).toMatchObject({
      code: "vcs_unauthorized",
      statusCode: 403,
    });
  });

  it("returns undefined for any other status", () => {
    expect(mapAdoAuthError({ statusCode: 404 })).toBeUndefined();
    expect(mapAdoAuthError({ statusCode: 500 })).toBeUndefined();
    expect(mapAdoAuthError(new Error("no statusCode at all"))).toBeUndefined();
  });
});

describe("adoRateLimitedError (R44)", () => {
  it("is a 429 vcs_rate_limited AppError", () => {
    const err = adoRateLimitedError();
    expect(err.code).toBe("vcs_rate_limited");
    expect(err.statusCode).toBe(429);
  });
});

describe("assertJsonResponse (R48)", () => {
  it("throws vcs_unauthorized for a 2xx HTML response (the observed 203-sign-in-page case)", () => {
    expect(() => assertJsonResponse(203, "text/html; charset=utf-8")).toThrow(
      expect.objectContaining({ code: "vcs_unauthorized", statusCode: 401 }),
    );
  });

  it("throws for a 200 with a missing content-type", () => {
    expect(() => assertJsonResponse(200, null)).toThrow(expect.objectContaining({ code: "vcs_unauthorized" }));
  });

  it("does not throw for a real JSON 2xx response", () => {
    expect(() => assertJsonResponse(200, "application/json; charset=utf-8")).not.toThrow();
  });

  it("does not throw for a >=300 status — the normal SDK error path owns that case", () => {
    expect(() => assertJsonResponse(401, "text/html")).not.toThrow();
    expect(() => assertJsonResponse(500, null)).not.toThrow();
  });
});

describe("adoRateLimitSnapshot / logAdoRateLimit (R45)", () => {
  it("extracts only the three whitelisted numeric fields, nothing else off the error object", () => {
    const err = {
      statusCode: 429,
      rateLimit: { remaining: 3, delay: 1.5, limit: 200, resource: "PullRequests", reset: 1234 },
    };
    expect(adoRateLimitSnapshot(err)).toEqual({ remaining: 3, delaySeconds: 1.5, limit: 200 });
  });

  it("falls back to retryAfter when delay is absent", () => {
    const err = { rateLimit: { retryAfter: 4, remaining: 0 } };
    expect(adoRateLimitSnapshot(err)).toEqual({ remaining: 0, delaySeconds: 4, limit: undefined });
  });

  it("returns undefined when there is no rateLimit info at all", () => {
    expect(adoRateLimitSnapshot(new Error("plain"))).toBeUndefined();
    expect(adoRateLimitSnapshot({ statusCode: 500 })).toBeUndefined();
  });

  it("logAdoRateLimit never logs anything resembling a token/PAT — only the numeric snapshot", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      logAdoRateLimit(
        { statusCode: 429, rateLimit: { remaining: 1, delay: 2 }, headers: { Authorization: "Basic super-secret-pat" } },
        "listPullRequests",
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const loggedArgs = warnSpy.mock.calls[0]!;
      const serialized = JSON.stringify(loggedArgs);
      expect(serialized).not.toContain("super-secret-pat");
      expect(serialized).toContain("listPullRequests");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("logAdoRateLimit is a no-op (no console.warn call) when there is no rate-limit info", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      logAdoRateLimit(new Error("plain"), "listPullRequests");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
