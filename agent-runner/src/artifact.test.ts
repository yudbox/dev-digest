import { describe, it, expect } from "vitest";
import type { Finding } from "@devdigest/shared";
import { CiResultArtifact } from "@devdigest/shared";
import { buildResultArtifact } from "./artifact.js";
import { RunnerError } from "./errors.js";

/**
 * Pure-unit tests for `buildResultArtifact` (SPEC-2026-07-19 AC-3/4/5). No fs,
 * no LLM — just the build + `CiResultArtifact.safeParse` contract.
 */

const CRITICAL_FINDING: Finding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded API credential",
  file: "src/config.ts",
  start_line: 10,
  end_line: 10,
  rationale: "provider credential literal committed to source",
  confidence: 0.97,
  kind: "finding",
};

const WARNING_FINDING: Finding = {
  id: "f2",
  severity: "WARNING",
  category: "bug",
  title: "Possible off-by-one",
  file: "src/loop.ts",
  start_line: 4,
  end_line: 6,
  rationale: "loop bound may skip last element",
  confidence: 0.6,
  kind: "finding",
};

describe("buildResultArtifact (SPEC-2026-07-19 findings artifact)", () => {
  it("AC-3: includes findings equal to the input array and safeParses", () => {
    const findings = [CRITICAL_FINDING, WARNING_FINDING];
    const artifact = buildResultArtifact({
      findings,
      costUsd: 0.002,
      durationMs: 1234,
      agent: "Security Reviewer",
      prNumber: 42,
    });

    expect(artifact.findings).toHaveLength(2);
    expect(artifact.findings).toEqual(findings);
    expect(CiResultArtifact.safeParse(artifact).success).toBe(true);
  });

  it("AC-5: maintains the invariant findings.length === findings_count", () => {
    const findings = [CRITICAL_FINDING, WARNING_FINDING];
    const artifact = buildResultArtifact({
      findings,
      costUsd: null,
      durationMs: 10,
      agent: "Security Reviewer",
      prNumber: 7,
    });

    expect(artifact.findings.length).toBe(artifact.findings_count);
    expect(artifact.findings_count).toBe(2);
  });

  it("AC-5: an empty findings array is a valid zero-finding artifact", () => {
    const artifact = buildResultArtifact({
      findings: [],
      costUsd: 0,
      durationMs: 5,
      agent: "Security Reviewer",
      prNumber: 1,
    });

    expect(artifact.findings).toEqual([]);
    expect(artifact.findings_count).toBe(0);
    expect(artifact.findings.length).toBe(artifact.findings_count);
  });

  it("AC-4: a malformed finding (severity out of enum) throws RunnerError", () => {
    const badFinding = {
      ...CRITICAL_FINDING,
      severity: "BOGUS",
    } as unknown as Finding;

    expect(() =>
      buildResultArtifact({
        findings: [badFinding],
        costUsd: 0.001,
        durationMs: 10,
        agent: "Security Reviewer",
        prNumber: 42,
      }),
    ).toThrow(RunnerError);
  });
});
