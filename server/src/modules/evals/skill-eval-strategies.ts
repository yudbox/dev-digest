import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import { RubricAssessment } from '@devdigest/shared';
import type { ExpectedFinding, Provider, SkillType } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { EvalCaseRow } from './repository.js';
import type { SkillRow } from '../skills/repository.js';
import { parseExpectedOutput, taskLine, prDescription } from './helpers.js';
import {
  scoreCase,
  scoreRubricCase,
  caseTypeOf,
  computePass,
  computeSkillPass,
  computeCitationAccuracy,
} from './scoring.js';
import { REFERENCE_PROMPT } from './reference-prompt.js';

/**
 * An extension-point registry: one `SkillEvalStrategy` per `skills.type`. A
 * future 5th skill type with yet another output contract is added by
 * registering one more strategy here, not by hunting `if`s across
 * execute/score/UI. `service.ts`'s per-case run path is the single branch
 * point that reads this registry (`SKILL_EVAL_STRATEGIES[skill.type]`).
 */

/** Everything a strategy needs to run one skill-owned case. `wrappedBody` is
 *  ALREADY the output of `EvalsService#wrapSkillBodyIfUntrusted` — strategies
 *  never see the raw skill body directly, so the untrusted-source wrapping
 *  guard cannot be accidentally bypassed by a strategy implementation. */
export interface SkillEvalContext {
  container: Container;
  provider: Provider;
  model: string;
  skill: SkillRow;
  evalCase: EvalCaseRow;
  wrappedBody: string;
}

export interface SkillEvalOutcome {
  actualOutput: unknown;
  recall: number;
  precision: number;
  citationAccuracy: number | null;
  pass: boolean;
  durationMs: number;
  costUsd: number | null;
}

export interface SkillEvalStrategy {
  /** Drives Diff/Files/Code tab visibility on the client (rubric = false). */
  usesDiff: boolean;
  execute(ctx: SkillEvalContext): Promise<SkillEvalOutcome>;
}

/**
 * `convention`/`security`/`custom` — the original with/without finding-grounded
 * logic (AC-24/AC-27/Q6), extracted verbatim in behaviour from the previous
 * inline `EvalsService#runOneSkillCase`. Exactly 2 `reviewPullRequest` calls:
 * one with the skill body appended to the fixed reference prompt, one without.
 */
export const findingGroundedStrategy: SkillEvalStrategy = {
  usesDiff: true,
  async execute(ctx: SkillEvalContext): Promise<SkillEvalOutcome> {
    const { container, provider, model, skill, evalCase, wrappedBody } = ctx;
    const expected = parseExpectedOutput(
      evalCase.expectedOutput,
      skill.type as SkillType,
    ) as ExpectedFinding[];
    const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');
    const llm = await container.llm(provider);
    const prDesc = prDescription(evalCase);
    const task = taskLine(evalCase);

    const withStart = Date.now();
    const withOutcome = await reviewPullRequest({
      systemPrompt: `${REFERENCE_PROMPT}\n\n${wrappedBody}`,
      model,
      diff,
      llm,
      ...(prDesc ? { prDescription: prDesc } : {}),
      task,
    });
    const withDurationMs = Date.now() - withStart;

    const withoutStart = Date.now();
    const withoutOutcome = await reviewPullRequest({
      systemPrompt: REFERENCE_PROMPT,
      model,
      diff,
      llm,
      ...(prDesc ? { prDescription: prDesc } : {}),
      task,
    });
    const withoutDurationMs = Date.now() - withoutStart;

    const withScore = scoreCase(expected, withOutcome.review.findings);
    const withoutScore = scoreCase(expected, withoutOutcome.review.findings);
    const caseType = caseTypeOf(expected);
    const pass = computeSkillPass(caseType, withScore, withoutScore);

    const withCitation = computeCitationAccuracy(
      withOutcome.review.findings.length,
      withOutcome.dropped.length,
    );
    const withoutCitation = computeCitationAccuracy(
      withoutOutcome.review.findings.length,
      withoutOutcome.dropped.length,
    );

    const durationMs = withDurationMs + withoutDurationMs;
    const costUsd =
      withOutcome.costUsd == null && withoutOutcome.costUsd == null
        ? null
        : (withOutcome.costUsd ?? 0) + (withoutOutcome.costUsd ?? 0);

    // Q6: top-level recall/precision/citation_accuracy mirror the WITH-skill
    // result (the headline number); the full with/without pair lives in
    // actual_output (jsonb — unstructured by design for exactly this).
    const actualOutput = {
      with: {
        findings: withOutcome.review.findings,
        recall: withScore.recall,
        precision: withScore.precision,
        citation_accuracy: withCitation,
      },
      without: {
        findings: withoutOutcome.review.findings,
        recall: withoutScore.recall,
        precision: withoutScore.precision,
        citation_accuracy: withoutCitation,
      },
    };

    return {
      actualOutput,
      recall: withScore.recall,
      precision: withScore.precision,
      citationAccuracy: withCitation,
      pass,
      durationMs,
      costUsd,
    };
  },
};

/**
 * `rubric` — a single direct `completeStructured` call, no with/without
 * comparison (confirmed with the user: a reference agent with no rubric text
 * doesn't know which dimensions to score, so with/without is meaningless
 * here, unlike the finding-grounded types). No `reviewPullRequest`/
 * `groundFindings` — there is no diff to ground findings against; the rubric
 * skill scores the PR holistically from its title/body alone.
 */
export const rubricStrategy: SkillEvalStrategy = {
  usesDiff: false,
  async execute(ctx: SkillEvalContext): Promise<SkillEvalOutcome> {
    const { container, provider, model, evalCase, wrappedBody } = ctx;
    const llm = await container.llm(provider);
    const task = taskLine(evalCase);
    const prDesc = prDescription(evalCase);
    const userContent = prDesc ? `${task}\n\n${prDesc}` : task;

    const start = Date.now();
    const structured = await llm.completeStructured({
      model,
      schema: z.array(RubricAssessment),
      schemaName: 'RubricAssessment',
      messages: [
        { role: 'system', content: wrappedBody },
        { role: 'user', content: userContent },
      ],
    });
    const durationMs = Date.now() - start;

    const expected = parseExpectedOutput(evalCase.expectedOutput, 'rubric') as RubricAssessment[];
    const actual = structured.data;
    const score = scoreRubricCase(expected, actual);
    const caseType = caseTypeOf(expected);
    const pass = computePass(caseType, score);

    return {
      actualOutput: actual,
      recall: score.recall,
      precision: score.precision,
      citationAccuracy: null,
      pass,
      durationMs,
      costUsd: structured.costUsd,
    };
  },
};

export const SKILL_EVAL_STRATEGIES: Record<SkillType, SkillEvalStrategy> = {
  rubric: rubricStrategy,
  convention: findingGroundedStrategy,
  security: findingGroundedStrategy,
  custom: findingGroundedStrategy,
};
