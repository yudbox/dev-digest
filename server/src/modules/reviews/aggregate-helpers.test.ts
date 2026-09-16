import { describe, it, expect } from 'vitest';
import type { AggregatedSource } from '@devdigest/shared';
import {
  collectSourceFindings,
  preGroupFindings,
  reconcileSeverity,
  groupId,
  groundGroups,
} from './aggregate-helpers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSrc(overrides: Partial<AggregatedSource> = {}): AggregatedSource {
  return {
    finding_id: 'f1',
    review_id: 'r1',
    run_id: 'run1',
    agent_id: 'a1',
    agent_name: 'Agent 1',
    severity: 'WARNING',
    file: 'src/foo.ts',
    start_line: 10,
    ...overrides,
  };
}

function makeRun(columns: object[]) {
  return { columns } as Parameters<typeof collectSourceFindings>[0];
}

// ---------------------------------------------------------------------------
// collectSourceFindings
// ---------------------------------------------------------------------------

describe('collectSourceFindings', () => {
  it('returns empty array for no columns', () => {
    expect(collectSourceFindings(makeRun([]))).toEqual([]);
  });

  it('skips columns whose status is not done', () => {
    const run = makeRun([
      { status: 'failed', findings: [{ id: 'f1', severity: 'WARNING', file: 'a.ts', start_line: 1, review_id: 'r1', run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
      { status: 'running', findings: [{ id: 'f2', severity: 'WARNING', file: 'b.ts', start_line: 2, review_id: 'r1', run_id: 'run1', agent_id: 'a1', agent_name: 'A' }] },
    ]);
    expect(collectSourceFindings(run)).toEqual([]);
  });

  it('includes findings from done columns only', () => {
    const run = makeRun([
      { status: 'done', agent_id: 'a1', agent_name: 'A', run_id: 'run1', findings: [
        { id: 'f1', severity: 'WARNING', file: 'a.ts', start_line: 10, review_id: 'r1' },
        { id: 'f2', severity: 'CRITICAL', file: 'b.ts', start_line: 20, review_id: 'r2' },
      ]},
      { status: 'failed', agent_id: 'a2', agent_name: 'B', run_id: 'run2', findings: [
        { id: 'f3', severity: 'SUGGESTION', file: 'c.ts', start_line: 5, review_id: 'r3' },
      ]},
    ]);
    const sources = collectSourceFindings(run);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.finding_id)).toEqual(['f1', 'f2']);
  });

  it('maps all AggregatedSource fields correctly', () => {
    const run = makeRun([
      { status: 'done', agent_id: 'agent-1', agent_name: 'SecurityBot', run_id: 'run-abc', findings: [
        { id: 'finding-xyz', severity: 'CRITICAL', file: 'lib/auth.ts', start_line: 42, review_id: 'review-1' },
      ]},
    ]);
    const [src] = collectSourceFindings(run);
    expect(src).toMatchObject({
      finding_id: 'finding-xyz',
      review_id: 'review-1',
      run_id: 'run-abc',
      agent_id: 'agent-1',
      agent_name: 'SecurityBot',
      severity: 'CRITICAL',
      file: 'lib/auth.ts',
      start_line: 42,
    });
  });
});

// ---------------------------------------------------------------------------
// preGroupFindings
// ---------------------------------------------------------------------------

describe('preGroupFindings', () => {
  it('returns empty for empty input', () => {
    expect(preGroupFindings([])).toEqual([]);
  });

  it('puts single finding in its own group', () => {
    const s = makeSrc();
    const groups = preGroupFindings([s]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([s]);
  });

  it('groups findings in same file within gap', () => {
    const s1 = makeSrc({ finding_id: 'f1', start_line: 10 });
    const s2 = makeSrc({ finding_id: 'f2', start_line: 18 });
    const groups = preGroupFindings([s1, s2], 10);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('splits findings beyond gap into separate groups', () => {
    const s1 = makeSrc({ finding_id: 'f1', start_line: 10 });
    const s2 = makeSrc({ finding_id: 'f2', start_line: 30 });
    const groups = preGroupFindings([s1, s2], 10);
    expect(groups).toHaveLength(2);
  });

  it('never groups findings from different files', () => {
    const s1 = makeSrc({ finding_id: 'f1', file: 'a.ts', start_line: 10 });
    const s2 = makeSrc({ finding_id: 'f2', file: 'b.ts', start_line: 10 });
    const groups = preGroupFindings([s1, s2]);
    expect(groups).toHaveLength(2);
  });

  it('groups three consecutive same-file findings into one group', () => {
    const s1 = makeSrc({ finding_id: 'f1', start_line: 5 });
    const s2 = makeSrc({ finding_id: 'f2', start_line: 10 });
    const s3 = makeSrc({ finding_id: 'f3', start_line: 15 });
    const groups = preGroupFindings([s1, s2, s3], 10);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// reconcileSeverity
// ---------------------------------------------------------------------------

describe('reconcileSeverity', () => {
  it('picks CRITICAL over WARNING and SUGGESTION', () => {
    const s1 = makeSrc({ finding_id: 'f1', severity: 'SUGGESTION' });
    const s2 = makeSrc({ finding_id: 'f2', severity: 'CRITICAL' });
    const s3 = makeSrc({ finding_id: 'f3', severity: 'WARNING' });
    const catMap = new Map([['f1', 'style'], ['f2', 'security'], ['f3', 'bug']]);
    const { severity, category } = reconcileSeverity([s1, s2, s3], catMap);
    expect(severity).toBe('CRITICAL');
    expect(category).toBe('security');
  });

  it('picks WARNING over SUGGESTION', () => {
    const s1 = makeSrc({ finding_id: 'f1', severity: 'SUGGESTION' });
    const s2 = makeSrc({ finding_id: 'f2', severity: 'WARNING' });
    const catMap = new Map([['f1', 'style'], ['f2', 'perf']]);
    const { severity, category } = reconcileSeverity([s1, s2], catMap);
    expect(severity).toBe('WARNING');
    expect(category).toBe('perf');
  });

  it('uses first-wins on tie (same severity)', () => {
    const s1 = makeSrc({ finding_id: 'f1', severity: 'WARNING' });
    const s2 = makeSrc({ finding_id: 'f2', severity: 'WARNING' });
    const catMap = new Map([['f1', 'bug'], ['f2', 'security']]);
    const { severity, category } = reconcileSeverity([s1, s2], catMap);
    expect(severity).toBe('WARNING');
    expect(category).toBe('bug'); // first one wins
  });

  it('falls back to "bug" when category is missing from map', () => {
    const s = makeSrc({ finding_id: 'f1', severity: 'CRITICAL' });
    const { category } = reconcileSeverity([s], new Map());
    expect(category).toBe('bug');
  });
});

// ---------------------------------------------------------------------------
// groupId
// ---------------------------------------------------------------------------

describe('groupId', () => {
  it('returns a 16-char hex string', () => {
    const id = groupId(['f1', 'f2']);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic regardless of input order', () => {
    const id1 = groupId(['f1', 'f2', 'f3']);
    const id2 = groupId(['f3', 'f1', 'f2']);
    expect(id1).toBe(id2);
  });

  it('is different for different sets of ids', () => {
    expect(groupId(['f1'])).not.toBe(groupId(['f2']));
  });
});

// ---------------------------------------------------------------------------
// groundGroups
// ---------------------------------------------------------------------------

describe('groundGroups', () => {
  const sources: AggregatedSource[] = [
    makeSrc({ finding_id: 'f1', file: 'a.ts', start_line: 10, severity: 'CRITICAL' }),
    makeSrc({ finding_id: 'f2', file: 'a.ts', start_line: 15, severity: 'WARNING' }),
    makeSrc({ finding_id: 'f3', file: 'b.ts', start_line: 5, severity: 'SUGGESTION' }),
  ];

  const details = new Map([
    ['f1', { end_line: 12, category: 'security' }],
    ['f2', { end_line: 17, category: 'bug' }],
    ['f3', { end_line: 8, category: 'style' }],
  ]);

  it('returns empty for empty LLM groups', () => {
    expect(groundGroups([], sources, details)).toEqual([]);
  });

  it('drops groups with unknown finding_ids', () => {
    const result = groundGroups(
      [{ finding_ids: ['unknown-id'], title: 'T', reviewer_comment: 'C' }],
      sources,
      details,
    );
    expect(result).toHaveLength(0);
  });

  it('builds a correct AggregatedFinding for a single-source group', () => {
    const result = groundGroups(
      [{ finding_ids: ['f3'], title: 'Style issue', reviewer_comment: 'Fix it\n\n---\n\nИсправить' }],
      sources,
      details,
    );
    expect(result).toHaveLength(1);
    const g = result[0]!;
    expect(g.file).toBe('b.ts');
    expect(g.severity).toBe('SUGGESTION');
    expect(g.category).toBe('style');
    expect(g.start_line).toBe(5);
    expect(g.end_line).toBe(8);
    expect(g.title).toBe('Style issue');
    expect(g.sources).toHaveLength(1);
  });

  it('merges two same-file sources into one group, taking max severity', () => {
    const result = groundGroups(
      [{ finding_ids: ['f1', 'f2'], title: 'Auth issue', reviewer_comment: 'Both findings' }],
      sources,
      details,
    );
    expect(result).toHaveLength(1);
    const g = result[0]!;
    expect(g.severity).toBe('CRITICAL');
    expect(g.category).toBe('security');
    expect(g.start_line).toBe(10);
    expect(g.end_line).toBe(17);
    expect(g.sources).toHaveLength(2);
  });

  it('drops cross-file finding_ids from a group', () => {
    // f1 is a.ts, f3 is b.ts — cannot mix
    const result = groundGroups(
      [{ finding_ids: ['f1', 'f3'], title: 'Mixed', reviewer_comment: 'C' }],
      sources,
      details,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.sources).toHaveLength(1); // only f1 (first file wins)
    expect(result[0]!.file).toBe('a.ts');
  });

  it('does not reuse a finding_id claimed by an earlier group', () => {
    const result = groundGroups(
      [
        { finding_ids: ['f1'], title: 'First', reviewer_comment: 'C' },
        { finding_ids: ['f1', 'f2'], title: 'Second', reviewer_comment: 'C' },
      ],
      sources,
      details,
    );
    expect(result).toHaveLength(2);
    // f1 was claimed by group 0 — group 1 gets only f2
    expect(result[1]!.sources).toHaveLength(1);
    expect(result[1]!.sources[0]!.finding_id).toBe('f2');
  });

  it('groupId is 16-char hex and consistent with groupId helper', () => {
    const result = groundGroups(
      [{ finding_ids: ['f1', 'f2'], title: 'T', reviewer_comment: 'C' }],
      sources,
      details,
    );
    expect(result[0]!.id).toMatch(/^[0-9a-f]{16}$/);
    expect(result[0]!.id).toBe(groupId(['f1', 'f2']));
  });
});
