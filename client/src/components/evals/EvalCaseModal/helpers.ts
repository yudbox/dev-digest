/** Pure helpers for EvalCaseModal — no React, no fetch. */
import { ExpectedFinding, RubricAssessment } from "@devdigest/shared";
import { z } from "zod";

/**
 * Which `expected_output` schema applies to this case, derived from the
 * owner: an agent-owned case always requires a real `file`; a manually-
 * written finding-grounded skill case (`convention`/`security`/`custom`)
 * omits `file` (the server injects the hidden `MANUAL_SKILL_CASE_FILE_PATH`);
 * a `rubric` skill case is a holistic dimension assessment, not a finding.
 */
export type ExpectedOutputKind = "rubric" | "skillFinding" | "agentFinding";

const AgentFindingArray = z.array(ExpectedFinding);
const SkillFindingArray = z.array(
  ExpectedFinding.extend({ file: z.string().optional() }),
);
const RubricArray = z.array(RubricAssessment);

function schemaFor(kind: ExpectedOutputKind) {
  if (kind === "rubric") return RubricArray;
  if (kind === "skillFinding") return SkillFindingArray;
  return AgentFindingArray;
}

/**
 * Derives the case type from `expected_output.length`, exactly mirroring the
 * server's one-line derivation (`server/src/modules/evals/scoring.ts`
 * `caseTypeOf`) so the POSITIVE/NEGATIVE banner always agrees with how the
 * server will score this case (AC-10). Works for both `ExpectedFinding[]`
 * and `RubricAssessment[]` — only `.length` is inspected.
 */
export function caseTypeOf(
  expectedOutput: unknown,
): "must_find" | "must_not_flag" {
  return Array.isArray(expectedOutput) && expectedOutput.length > 0
    ? "must_find"
    : "must_not_flag";
}

/**
 * Safely parse + validate the `expected_output` JSON textarea value against
 * the schema for this case's owner (`kind`). Returns `null` on invalid JSON
 * OR a schema mismatch (caller renders the invalid-JSON indicator + disables
 * save) — this is now the primary defence against malformed input, ahead of
 * the server's last-resort silent-`[]` fallback.
 */
export type ExpectedOutputError = "syntax" | "schema" | null;

export function tryParseExpectedOutput(
  raw: string,
  kind: ExpectedOutputKind = "agentFinding",
): unknown[] | null {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const result = schemaFor(kind).safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Returns the reason validation failed, or null if valid.
 * Distinguishes JSON syntax errors from schema mismatches so the UI
 * can show "invalid JSON" vs "invalid schema" respectively.
 */
export function getExpectedOutputError(
  raw: string,
  kind: ExpectedOutputKind = "agentFinding",
): ExpectedOutputError {
  if (!raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "syntax";
  }
  if (!Array.isArray(parsed)) return "schema";
  const result = schemaFor(kind).safeParse(parsed);
  return result.success ? null : "schema";
}

/** Pretty-print a value for the expected_output textarea's initial contents. */
export function stringifyExpectedOutput(value: unknown): string {
  if (value == null) return "[]";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[]";
  }
}

/**
 * The "+ Dimension/Finding skeleton" button inserts one blank entry shaped
 * for this case's owner. Finding-grounded SKILL skeletons omit `file` (the
 * server injects `MANUAL_SKILL_CASE_FILE_PATH`); agent skeletons keep the
 * real `file` field; rubric skeletons are a dimension assessment, not a
 * finding at all.
 */
export function skeletonFor(kind: ExpectedOutputKind): Record<string, unknown> {
  if (kind === "rubric") return { dimension: "", score: 0, reason: "" };
  if (kind === "skillFinding") {
    return {
      start_line: 0,
      end_line: 0,
      severity: "",
      category: "",
      title: "",
    };
  }
  return {
    file: "src/example.ts",
    start_line: 1,
    end_line: 1,
    severity: "CRITICAL",
    category: "security",
    title: "",
  };
}
