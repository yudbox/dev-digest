import { describe, it, expect, vi } from "vitest";
import type { Container } from "../../platform/container.js";
import { RunLogger } from "../../platform/run-logger.js";
import { RunBus } from "../../platform/sse.js";
import {
  extractLinkedIssueNumber,
  extractPlanPath,
  buildMissingContextNote,
  gatherIntentContext,
} from "./intent-context.js";

// ── extractLinkedIssueNumber ─────────────────────────────────────────────────

describe("extractLinkedIssueNumber", () => {
  it("extracts Closes/Fixes/Resolves #N (case-insensitive)", () => {
    expect(extractLinkedIssueNumber("Closes #42")).toBe(42);
    expect(extractLinkedIssueNumber("fixes #7")).toBe(7);
    expect(extractLinkedIssueNumber("Resolves #123 and more text")).toBe(123);
  });

  it("returns undefined when there is no such link", () => {
    expect(extractLinkedIssueNumber("Just a description")).toBeUndefined();
    expect(extractLinkedIssueNumber(null)).toBeUndefined();
    expect(extractLinkedIssueNumber(undefined)).toBeUndefined();
  });
});

// ── extractPlanPath ──────────────────────────────────────────────────────────

describe("extractPlanPath", () => {
  it.each([
    ["specs/PLAN-x.md", "specs/PLAN-x.md"],
    ["plans/SPEC-a_b-1.md", "plans/SPEC-a_b-1.md"],
    ["server/specs/SPEC-2026-09-23-foo.md", "server/specs/SPEC-2026-09-23-foo.md"],
    ["See [plan](plans/PLAN-x.md) for details.", "plans/PLAN-x.md"],
    ["Trailing punctuation: specs/PLAN-x.md.", "specs/PLAN-x.md"],
  ])("accepts %s", (body, expected) => {
    expect(extractPlanPath(body)).toBe(expected);
  });

  it("returns the first match when the body links two plan paths", () => {
    const body = "See specs/PLAN-a.md and also plans/PLAN-b.md";
    expect(extractPlanPath(body)).toBe("specs/PLAN-a.md");
  });

  it.each([
    ["../../etc/passwd"],
    ["/abs/PLAN-x.md"],
    ["specs/PLAN-x.txt"],
    ["specs/../PLAN-x.md"],
    ["docs/PLAN-x.md"],
    ["https://github.com/o/r/blob/main/specs/PLAN-x.md"],
  ])("rejects %s", (body) => {
    expect(extractPlanPath(body)).toBeUndefined();
  });

  it("returns undefined for an empty/absent body", () => {
    expect(extractPlanPath(null)).toBeUndefined();
    expect(extractPlanPath("")).toBeUndefined();
  });
});

// ── buildMissingContextNote ──────────────────────────────────────────────────

describe("buildMissingContextNote", () => {
  it("returns undefined when nothing is missing", () => {
    expect(buildMissingContextNote({})).toBeUndefined();
  });

  it("mentions only the issue when only the issue is missing", () => {
    const note = buildMissingContextNote({ issueNumber: 42 });
    expect(note).toContain("#42");
    expect(note).not.toContain("plan");
  });

  it("mentions only the plan when only the plan is missing", () => {
    const note = buildMissingContextNote({ planPath: "specs/PLAN-x.md" });
    expect(note).toContain("specs/PLAN-x.md");
    expect(note).not.toContain("issue #");
  });

  it("mentions both, joined by '; ', when both are missing", () => {
    const note = buildMissingContextNote({
      issueNumber: 42,
      planPath: "specs/PLAN-x.md",
    });
    expect(note).toContain("#42");
    expect(note).toContain("specs/PLAN-x.md");
    expect(note).toMatch(/#42.*; .*specs\/PLAN-x\.md/);
  });
});

// ── gatherIntentContext ──────────────────────────────────────────────────────

function makeLog() {
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const runLog = new RunLogger(new RunBus(), ["run-1"], base);
  return { base, runLog };
}

function makeContainer(opts: {
  getIssue?: ReturnType<typeof vi.fn>;
  readFileAtRef?: ReturnType<typeof vi.fn>;
}): Container {
  return {
    vcs: vi.fn().mockResolvedValue({
      getIssue: opts.getIssue ?? vi.fn().mockRejectedValue(new Error("not configured")),
    }),
    git: {
      readFileAtRef:
        opts.readFileAtRef ?? vi.fn().mockRejectedValue(new Error("not found")),
    },
  } as unknown as Container;
}

const REPO_ROW = { owner: "acme", name: "widgets", vcsProvider: "github" } as unknown as Parameters<
  typeof gatherIntentContext
>[1];

describe("gatherIntentContext", () => {
  it("getIssue throws → missing.issueNumber, log mentions #N", async () => {
    const getIssue = vi.fn().mockRejectedValue(new Error("404"));
    const container = makeContainer({ getIssue });
    const { base, runLog } = makeLog();

    const ctx = await gatherIntentContext(
      container,
      REPO_ROW,
      { body: "Closes #42" },
      "abc1234",
      runLog,
    );

    expect(ctx.missing.issueNumber).toBe(42);
    expect(ctx.issue).toBeUndefined();
    expect(base.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("#42"),
    );
  });

  it("readFileAtRef throws → missing.planPath", async () => {
    const readFileAtRef = vi.fn().mockRejectedValue(new Error("not found"));
    const container = makeContainer({ readFileAtRef });
    const { runLog } = makeLog();

    const ctx = await gatherIntentContext(
      container,
      REPO_ROW,
      { body: "See specs/PLAN-x.md" },
      "abc1234",
      runLog,
    );

    expect(ctx.missing.planPath).toBe("specs/PLAN-x.md");
    expect(ctx.plan).toBeUndefined();
  });

  it("headSha=null → missing.planPath, readFileAtRef never called", async () => {
    const readFileAtRef = vi.fn();
    const container = makeContainer({ readFileAtRef });
    const { runLog } = makeLog();

    const ctx = await gatherIntentContext(
      container,
      REPO_ROW,
      { body: "See specs/PLAN-x.md" },
      null,
      runLog,
    );

    expect(ctx.missing.planPath).toBe("specs/PLAN-x.md");
    expect(readFileAtRef).not.toHaveBeenCalled();
  });

  it("non-matching plan link → no file read at all (AC-42)", async () => {
    const readFileAtRef = vi.fn();
    const container = makeContainer({ readFileAtRef });
    const { runLog } = makeLog();

    const ctx = await gatherIntentContext(
      container,
      REPO_ROW,
      { body: "https://github.com/o/r/blob/main/specs/PLAN-x.md" },
      "abc1234",
      runLog,
    );

    expect(ctx.missing.planPath).toBeUndefined();
    expect(ctx.plan).toBeUndefined();
    expect(readFileAtRef).not.toHaveBeenCalled();
  });

  it("both succeed → issue and plan populated, nothing missing", async () => {
    const getIssue = vi.fn().mockResolvedValue({
      number: 42,
      title: "Do the thing",
      body: "Some body",
      state: "open",
    });
    const readFileAtRef = vi.fn().mockResolvedValue("# Plan content");
    const container = makeContainer({ getIssue, readFileAtRef });
    const { runLog } = makeLog();

    const ctx = await gatherIntentContext(
      container,
      REPO_ROW,
      { body: "Closes #42, see specs/PLAN-x.md" },
      "abc1234",
      runLog,
    );

    expect(ctx.issue?.number).toBe(42);
    expect(ctx.plan).toEqual({ path: "specs/PLAN-x.md", content: "# Plan content" });
    expect(ctx.missing).toEqual({});
    expect(buildMissingContextNote(ctx.missing)).toBeUndefined();
  });

  it("no issue link and no plan link → nothing fetched, nothing missing", async () => {
    const getIssue = vi.fn();
    const readFileAtRef = vi.fn();
    const container = makeContainer({ getIssue, readFileAtRef });
    const { runLog } = makeLog();

    const ctx = await gatherIntentContext(
      container,
      REPO_ROW,
      { body: "Just a description, nothing linked." },
      "abc1234",
      runLog,
    );

    expect(getIssue).not.toHaveBeenCalled();
    expect(readFileAtRef).not.toHaveBeenCalled();
    expect(ctx.missing).toEqual({});
  });
});
