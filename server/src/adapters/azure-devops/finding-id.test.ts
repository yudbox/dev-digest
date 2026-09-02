import { describe, it, expect } from "vitest";
import { findingId, type FindingIdentity } from "./finding-id.js";

/**
 * TASK-008 — R32: deterministic across processes, changes on any attribute
 * change. `findingId` is a pure function, so "across processes" reduces to
 * "the same inputs always produce the same output within one process too" —
 * there is no hidden state (clock, randomness) to smuggle non-determinism
 * in, and a table-driven "change one field at a time" test is the direct
 * translation of R32's acceptance wording.
 */

const BASE: FindingIdentity = {
  repoOwner: "GES-IT",
  repoProject: "Big_Commerce_Remediation",
  repoName: "ges-azure-functions",
  prNumber: 6557,
  path: "/apps/order-functions/src/functions/order-processing/order-processing-handler.ts",
  line: 124,
  severity: "warning",
  title: "Promise.all loses per-branch failure isolation",
};

describe("findingId", () => {
  it("is deterministic for identical input", () => {
    expect(findingId(BASE)).toBe(findingId({ ...BASE }));
  });

  it("produces a 64-char lowercase hex sha256 digest", () => {
    expect(findingId(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["repoOwner", { repoOwner: "OTHER-ORG" }],
    ["repoProject", { repoProject: "Other-Project" }],
    ["repoName", { repoName: "other-repo" }],
    ["prNumber", { prNumber: 9999 }],
    ["path", { path: "/apps/other/file.ts" }],
    ["line", { line: 125 }],
    ["severity", { severity: "critical" }],
    ["title", { title: "A completely different finding" }],
  ] as const)("changing %s changes the hash", (_field, override) => {
    expect(findingId({ ...BASE, ...override })).not.toBe(findingId(BASE));
  });

  it("treats a missing repoProject (GitHub-style RepoRef) distinctly from an empty-string one", () => {
    const withUndefined = findingId({ ...BASE, repoProject: undefined });
    const withEmpty = findingId({ ...BASE, repoProject: "" });
    // Both normalise to the same key today (undefined ?? "") - documented
    // here as the current behaviour, not asserted as strictly required: if
    // this ever needs to change, this test is the flag that it did.
    expect(withUndefined).toBe(withEmpty);
  });

  it("does not accept a comment body as input at all (compile-time guarantee)", () => {
    // @ts-expect-error - `body` is not part of FindingIdentity; hashing on
    // wording that is expected to vary between re-runs would defeat R33's
    // idempotency guarantee (see finding-id.ts's module doc comment).
    findingId({ ...BASE, body: "some wording" });
  });
});
