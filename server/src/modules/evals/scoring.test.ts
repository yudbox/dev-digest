import { describe, it, expect } from 'vitest';
import type { Finding, ExpectedFinding } from '@devdigest/shared';
import { MockLLMProvider } from '../../adapters/mocks.js';
import {
  scoreCase,
  computePass,
  computeCitationAccuracy,
  computeSkillPass,
  caseTypeOf,
} from './scoring.js';

function expectedFinding(overrides: Partial<ExpectedFinding> = {}): ExpectedFinding {
  return { file: 'src/foo.ts', start_line: 10, end_line: 12, ...overrides };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    file: 'src/foo.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    ...overrides,
  };
}

describe('scoring.ts — hermetic, ZERO LLM calls', () => {
  // Sentinel: this file must never call an LLM. We instantiate a call-counting
  // mock but never pass it into any function under test — if scoring.ts ever
  // grows an LLM dependency, this counter would need to be threaded through
  // and a reviewer would immediately notice `calls.length > 0` below.
  const llmCallCounter = new MockLLMProvider();

  describe('scoreCase (AC-3, AC-4)', () => {
    it('matches same file + overlapping range → tp=1, recall=1, precision=1', () => {
      const expected = [expectedFinding()];
      const actual = [finding()];
      const result = scoreCase(expected, actual);
      expect(result).toEqual({ recall: 1, precision: 1, tp: 1, fp: 0, fn: 0 });
    });

    it('same file, non-overlapping range → miss (fn=1) and false positive (fp=1)', () => {
      const expected = [expectedFinding({ start_line: 10, end_line: 12 })];
      const actual = [finding({ start_line: 50, end_line: 52 })];
      const result = scoreCase(expected, actual);
      expect(result).toEqual({ recall: 0, precision: 0, tp: 0, fp: 1, fn: 1 });
    });

    it('different file entirely → no match even with overlapping lines', () => {
      const expected = [expectedFinding({ file: 'src/a.ts' })];
      const actual = [finding({ file: 'src/b.ts' })];
      const result = scoreCase(expected, actual);
      expect(result).toEqual({ recall: 0, precision: 0, tp: 0, fp: 1, fn: 1 });
    });

    it('AC-4: recall=1.0 when expected is empty (nothing to find)', () => {
      const result = scoreCase([], [finding()]);
      expect(result.recall).toBe(1.0);
      expect(result.precision).toBe(0); // the one actual finding is an unmatched false positive
    });

    it('AC-4: precision=1.0 when actual is empty (nothing flagged)', () => {
      const result = scoreCase([expectedFinding()], []);
      expect(result.precision).toBe(1.0);
      expect(result.recall).toBe(0);
    });

    it('AC-4: both empty → recall=1.0 and precision=1.0', () => {
      const result = scoreCase([], []);
      expect(result).toEqual({ recall: 1, precision: 1, tp: 0, fp: 0, fn: 0 });
    });
  });

  describe('caseTypeOf (AC-10)', () => {
    it('non-empty expected_output → must_find', () => {
      expect(caseTypeOf([expectedFinding()])).toBe('must_find');
    });
    it('empty expected_output → must_not_flag', () => {
      expect(caseTypeOf([])).toBe('must_not_flag');
    });
  });

  describe('computePass (AC-6, AC-11 truth table)', () => {
    it('must_find passes only when recall=1 AND precision=1', () => {
      expect(computePass('must_find', { recall: 1, precision: 1, tp: 1, fp: 0, fn: 0 })).toBe(
        true,
      );
      expect(computePass('must_find', { recall: 1, precision: 0.5, tp: 1, fp: 1, fn: 0 })).toBe(
        false,
      );
      expect(computePass('must_find', { recall: 0, precision: 1, tp: 0, fp: 0, fn: 1 })).toBe(
        false,
      );
    });

    it('must_not_flag passes iff precision=1 (recall is irrelevant)', () => {
      expect(computePass('must_not_flag', { recall: 1, precision: 1, tp: 0, fp: 0, fn: 0 })).toBe(
        true,
      );
      expect(
        computePass('must_not_flag', { recall: 0, precision: 0, tp: 0, fp: 1, fn: 0 }),
      ).toBe(false);
    });
  });

  describe('computeCitationAccuracy (AC-8)', () => {
    it('computeCitationAccuracy(3,1) → 0.75', () => {
      expect(computeCitationAccuracy(3, 1)).toBe(0.75);
    });
    it('computeCitationAccuracy(0,0) → 1.0', () => {
      expect(computeCitationAccuracy(0, 0)).toBe(1.0);
    });
  });

  describe('computeSkillPass (AC-7, AC-27 truth table)', () => {
    const pass = { recall: 1, precision: 1, tp: 1, fp: 0, fn: 0 };
    const fail = { recall: 0, precision: 1, tp: 0, fp: 0, fn: 1 };

    it('must_find: with passes AND without fails → true', () => {
      expect(computeSkillPass('must_find', pass, fail)).toBe(true);
    });

    it('must_find: both pass (skill made no difference) → false', () => {
      expect(computeSkillPass('must_find', pass, pass)).toBe(false);
    });

    it('must_find: with fails → false regardless of without', () => {
      expect(computeSkillPass('must_find', fail, fail)).toBe(false);
    });

    it('must_not_flag: with-skill precision=1 → true (without is not part of the gate)', () => {
      const withScore = { recall: 1, precision: 1, tp: 0, fp: 0, fn: 0 };
      const withoutScore = { recall: 1, precision: 1, tp: 0, fp: 0, fn: 0 };
      expect(computeSkillPass('must_not_flag', withScore, withoutScore)).toBe(true);
    });

    it('must_not_flag: with-skill precision<1 → false', () => {
      const withScore = { recall: 0, precision: 0, tp: 0, fp: 1, fn: 0 };
      const withoutScore = { recall: 0, precision: 0, tp: 0, fp: 1, fn: 0 };
      expect(computeSkillPass('must_not_flag', withScore, withoutScore)).toBe(false);
    });
  });

  it('never calls an LLM anywhere in this file’s call graph', () => {
    expect(llmCallCounter.calls.length).toBe(0);
  });
});
