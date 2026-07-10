import type { Finding, ExpectedFinding, RubricAssessment } from '@devdigest/shared';
import { rangesOverlap } from '@devdigest/reviewer-core';

/**
 * A5 — eval scoring engine (pure, ZERO LLM calls). This file must never import
 * Fastify, Drizzle, or an LLMProvider — it is domain/application logic, called
 * AFTER `reviewPullRequest` has already produced the actual findings.
 *
 * Match rule (AC-3): an expected finding and an actual finding match iff they
 * reference the SAME file AND their [start_line, end_line] ranges overlap
 * (`rangesOverlap`, imported from `@devdigest/reviewer-core` — Q5).
 */

export interface ScoreResult {
  recall: number;
  precision: number;
  tp: number;
  fp: number;
  fn: number;
}

export type EvalCaseType = 'must_find' | 'must_not_flag';

function isMatch(expected: ExpectedFinding, actual: Finding): boolean {
  return (
    expected.file === actual.file &&
    rangesOverlap(expected.start_line, expected.end_line, actual.start_line, actual.end_line)
  );
}

/**
 * A rubric assessment "matches" the expected one iff they name the same
 * dimension (case/whitespace-insensitive) — rubric scoring has no file/line
 * range to compare against, unlike `isMatch` above.
 */
function isRubricMatch(expected: RubricAssessment, actual: RubricAssessment): boolean {
  return expected.dimension.trim().toLowerCase() === actual.dimension.trim().toLowerCase();
}

/**
 * Derives the case type from `expected_output` alone — the SAME one-line rule
 * used by the client's POSITIVE/NEGATIVE banner (AC-10). Keep this the single
 * source of truth so server and client never disagree on a case's type. Works
 * identically for `ExpectedFinding[]` (agent/finding-grounded skill cases) and
 * `RubricAssessment[]` (rubric skill cases) — only `.length` is inspected.
 */
export function caseTypeOf(expected: ExpectedFinding[] | RubricAssessment[]): EvalCaseType {
  return expected.length > 0 ? 'must_find' : 'must_not_flag';
}

/**
 * Score one case's actual findings against its expected findings.
 *
 * `tp` is counted from the expected side (how many expected findings were
 * matched by at least one actual finding) and reused as the numerator for
 * both recall and precision — correct for the common case of non-overlapping,
 * 0-or-1 expected findings per case (the only shape `POST /findings/:id/eval-case`
 * produces). `fp` is the count of actual findings that matched no expected
 * finding at all.
 */
export function scoreCase(expected: ExpectedFinding[], actual: Finding[]): ScoreResult {
  const tp = expected.filter((e) => actual.some((a) => isMatch(e, a))).length;
  const fn = expected.length - tp;
  const matchedActualCount = actual.filter((a) => expected.some((e) => isMatch(e, a))).length;
  const fp = actual.length - matchedActualCount;

  // AC-4: recall = 1.0 when there was nothing to find; precision = 1.0 when
  // nothing was flagged (both trivially "correct" — no missed / no false alarm).
  const recall = expected.length === 0 ? 1.0 : tp / (tp + fn);
  const precision = actual.length === 0 ? 1.0 : tp / (tp + fp);

  return { recall, precision, tp, fp, fn };
}

/**
 * Score one rubric-type case's actual dimension assessments against its
 * expected ones. Identical tp/fp/fn/recall/precision math to `scoreCase`
 * (matching by dimension name via `isRubricMatch` instead of file+range via
 * `isMatch`). `score`/`reason` on either side do NOT affect pass/fail — they
 * are diagnostic only, same role as `rationale` on a normal `Finding`.
 */
export function scoreRubricCase(
  expected: RubricAssessment[],
  actual: RubricAssessment[],
): ScoreResult {
  const tp = expected.filter((e) => actual.some((a) => isRubricMatch(e, a))).length;
  const fn = expected.length - tp;
  const matchedActualCount = actual.filter((a) => expected.some((e) => isRubricMatch(e, a))).length;
  const fp = actual.length - matchedActualCount;

  const recall = expected.length === 0 ? 1.0 : tp / (tp + fn);
  const precision = actual.length === 0 ? 1.0 : tp / (tp + fp);

  return { recall, precision, tp, fp, fn };
}

/**
 * AC-11 pass truth table:
 *  - must_find:     recall === 1 AND precision === 1 (found the issue, no noise)
 *  - must_not_flag: precision === 1 (nothing incorrectly flagged in-region)
 */
export function computePass(caseType: EvalCaseType, score: ScoreResult): boolean {
  if (caseType === 'must_find') return score.recall === 1 && score.precision === 1;
  return score.precision === 1;
}

/**
 * AC-12: citation accuracy is the fraction of candidate findings that survived
 * `groundFindings` — reuses the SAME grounding pass already run inside
 * `reviewPullRequest` (kept vs dropped counts), never a second grounding pass.
 */
export function computeCitationAccuracy(keptCount: number, droppedCount: number): number {
  const total = keptCount + droppedCount;
  return total === 0 ? 1.0 : keptCount / total;
}

/**
 * AC-27 (v1, pinned — Q2): skill-case pass requires the skill to make the
 * difference between the with-skill and without-skill runs.
 *  - must_find:     with-skill passes the must_find criterion AND
 *                    without-skill does NOT (no threshold — literal boolean gate).
 *  - must_not_flag: with-skill alone must have precision === 1 (the skill must
 *                    not introduce a false flag in the region); the without-skill
 *                    run is not part of this criterion.
 */
export function computeSkillPass(
  caseType: EvalCaseType,
  withScore: ScoreResult,
  withoutScore: ScoreResult,
): boolean {
  if (caseType === 'must_find') {
    return computePass('must_find', withScore) && !computePass('must_find', withoutScore);
  }
  return withScore.precision === 1;
}
