import { describe, it, expect } from "vitest";
import type { FindingRecord, SmartDiff } from "@devdigest/shared";
import {
  indexLineFindings,
  isActive,
  hasActive,
  mostSevereActive,
  splitByRenderedLines,
} from "./findings";

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 10,
    end_line: 10,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function makeSmartDiff(files: { path: string; line_findings: FindingRecord[] | null }[]): SmartDiff {
  return {
    groups: [
      {
        role: "core",
        files: files.map((f) => ({
          path: f.path,
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          line_findings: f.line_findings,
        })),
      },
    ],
    split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
    review_tokens: null,
  };
}

describe("indexLineFindings", () => {
  it("keeps every finding as given, with no filtering", () => {
    const findings = [makeFinding({ id: "f1" }), makeFinding({ id: "f2", accepted_at: "2026-01-01" })];
    const smartDiff = makeSmartDiff([{ path: "src/a.ts", line_findings: findings }]);
    const byFile = indexLineFindings(smartDiff);
    expect(byFile.get("src/a.ts")).toEqual(findings);
  });

  it("omits files whose line_findings is null (no review has run)", () => {
    const smartDiff = makeSmartDiff([
      { path: "src/a.ts", line_findings: null },
      { path: "src/b.ts", line_findings: [] },
    ]);
    const byFile = indexLineFindings(smartDiff);
    expect(byFile.has("src/a.ts")).toBe(false);
    expect(byFile.get("src/b.ts")).toEqual([]);
  });
});

describe("hasActive / isActive", () => {
  it("an accepted finding is not active", () => {
    const accepted = makeFinding({ accepted_at: "2026-01-01T00:00:00Z" });
    expect(isActive(accepted)).toBe(false);
    expect(hasActive([accepted])).toBe(false);
  });

  it("a file with one active and one accepted finding still counts as having an active one", () => {
    const active = makeFinding({ id: "f1" });
    const accepted = makeFinding({ id: "f2", accepted_at: "2026-01-01T00:00:00Z" });
    expect(hasActive([active, accepted])).toBe(true);
  });
});

describe("mostSevereActive", () => {
  it("picks CRITICAL over SUGGESTION and ignores accepted findings", () => {
    const findings = [
      makeFinding({ id: "f1", severity: "SUGGESTION" }),
      makeFinding({ id: "f2", severity: "CRITICAL", accepted_at: "2026-01-01" }),
      makeFinding({ id: "f3", severity: "WARNING" }),
    ];
    expect(mostSevereActive(findings)?.id).toBe("f3");
  });

  it("returns null when there are no active findings", () => {
    expect(mostSevereActive([makeFinding({ accepted_at: "2026-01-01" })])).toBeNull();
    expect(mostSevereActive([])).toBeNull();
  });
});

describe("splitByRenderedLines", () => {
  it("anchors a finding whose start_line has a rendered new-side line", () => {
    const f = makeFinding({ start_line: 5 });
    const { byLine, unanchored } = splitByRenderedLines([f], new Set([5, 6]));
    expect(byLine.get(5)).toEqual([f]);
    expect(unanchored).toEqual([]);
  });

  it("a finding on a deleted line (no new-side line number) goes to unanchored (AC-30)", () => {
    const f = makeFinding({ start_line: 5 });
    const { byLine, unanchored } = splitByRenderedLines([f], new Set([1, 2, 3]));
    expect(byLine.size).toBe(0);
    expect(unanchored).toEqual([f]);
  });

  it("patch: null (no rendered lines at all) → every finding is unanchored", () => {
    const findings = [makeFinding({ id: "f1", start_line: 1 }), makeFinding({ id: "f2", start_line: 2 })];
    const { byLine, unanchored } = splitByRenderedLines(findings, new Set());
    expect(byLine.size).toBe(0);
    expect(unanchored).toHaveLength(2);
  });
});
