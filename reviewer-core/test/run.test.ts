import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });
});

/**
 * Skill attribution + cost provenance. A controllable stub provider replaces the
 * mock so each chunk can report its own skills_applied / costUsd / costSource.
 */
describe('reviewPullRequest — skills_applied, rule_refs, costSource', () => {
  const TWO_FILE_DIFF = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const a = 1;',
    '+const secret = "sk_live_aaa";',
    ' export { a };',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1,2 +1,3 @@',
    ' const b = 1;',
    '+const token = "ghp_bbb";',
    ' export { b };',
  ].join('\n');

  const finding = (id: string, file: string, line: number, rule_refs?: string[]) => ({
    id,
    severity: 'WARNING',
    category: 'security',
    title: `finding ${id}`,
    file,
    start_line: line,
    end_line: line,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
    ...(rule_refs ? { rule_refs } : {}),
  });

  const review = (over: Record<string, unknown> = {}) => ({
    verdict: 'comment',
    summary: 's',
    score: 80,
    findings: [] as unknown[],
    ...over,
  });

  type Reply = {
    review: unknown;
    costUsd: number | null;
    costSource?: 'api' | 'estimate' | null;
  };

  function stubLlm(replies: Reply[]): LLMProvider {
    let i = 0;
    return {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        const r = replies[Math.min(i++, replies.length - 1)]!;
        return {
          data: r.review as T,
          model: req.model,
          tokensIn: 10,
          tokensOut: 5,
          costUsd: r.costUsd,
          ...(r.costSource !== undefined ? { costSource: r.costSource } : {}),
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
  }

  const run = async (llm: LLMProvider, strategy: 'single-pass' | 'map-reduce' = 'single-pass') => {
    const diff = await new MockGitClient({ diff: TWO_FILE_DIFF }).diff();
    return reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm, strategy });
  };

  it('single-pass: surfaces skills_applied and keeps rule_refs on surviving findings', async () => {
    const llm = stubLlm([
      {
        review: review({
          skills_applied: ['S1', 'S3'],
          findings: [finding('f1', 'src/a.ts', 2, ['S1'])],
        }),
        costUsd: 0.01,
        costSource: 'api',
      },
    ]);
    const outcome = await run(llm);
    expect(outcome.skillsApplied).toEqual(['S1', 'S3']);
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.rule_refs).toEqual(['S1']);
    // engine metadata is lifted out of the persisted review shape
    expect(outcome.review).not.toHaveProperty('skills_applied');
  });

  it('a finding dropped by grounding takes its rule_refs with it', async () => {
    const llm = stubLlm([
      {
        review: review({
          skills_applied: ['S2'],
          findings: [finding('real', 'src/a.ts', 2, ['S1']), finding('ghost', 'src/a.ts', 999, ['S2'])],
        }),
        costUsd: 0,
      },
    ]);
    const outcome = await run(llm);
    expect(outcome.review.findings.map((f) => f.id)).toEqual(['real']);
    expect(outcome.dropped.map((d) => d.finding.id)).toEqual(['ghost']);
    const surviving = outcome.review.findings.flatMap((f) => f.rule_refs ?? []);
    expect(surviving).not.toContain('S2');
  });

  it('skillsApplied is null (unknown) when the model omitted the field', async () => {
    const outcome = await run(stubLlm([{ review: review(), costUsd: 0 }]));
    expect(outcome.skillsApplied).toBeNull();
  });

  it('map-reduce: skillsApplied is the first-seen union over chunks', async () => {
    const llm = stubLlm([
      { review: review({ skills_applied: ['S1'] }), costUsd: 0.01, costSource: 'api' },
      { review: review({ skills_applied: ['S2', 'S1'] }), costUsd: 0.01, costSource: 'api' },
    ]);
    const outcome = await run(llm, 'map-reduce');
    expect(outcome.mode).toBe('map-reduce');
    expect(outcome.skillsApplied).toEqual(['S1', 'S2']);
  });

  it('map-reduce: null when every chunk omitted it, [] when one explicitly reported none', async () => {
    const allOmitted = await run(
      stubLlm([
        { review: review(), costUsd: 0 },
        { review: review(), costUsd: 0 },
      ]),
      'map-reduce',
    );
    expect(allOmitted.skillsApplied).toBeNull();

    const oneEmpty = await run(
      stubLlm([
        { review: review(), costUsd: 0 },
        { review: review({ skills_applied: [] }), costUsd: 0 },
      ]),
      'map-reduce',
    );
    expect(oneEmpty.skillsApplied).toEqual([]);
  });

  it("costSource is 'api' only when every chunk reported a provider cost", async () => {
    const outcome = await run(
      stubLlm([
        { review: review(), costUsd: 0.01, costSource: 'api' },
        { review: review(), costUsd: 0.02, costSource: 'api' },
      ]),
      'map-reduce',
    );
    expect(outcome.costUsd).toBeCloseTo(0.03, 9);
    expect(outcome.costSource).toBe('api');
  });

  it("costSource degrades to 'estimate' when any chunk was estimated", async () => {
    const outcome = await run(
      stubLlm([
        { review: review(), costUsd: 0.01, costSource: 'api' },
        { review: review(), costUsd: 0.02, costSource: 'estimate' },
      ]),
      'map-reduce',
    );
    expect(outcome.costSource).toBe('estimate');
  });

  it('costSource is null when the cost is unknown for any chunk', async () => {
    const outcome = await run(
      stubLlm([
        { review: review(), costUsd: 0.01, costSource: 'api' },
        { review: review(), costUsd: null, costSource: null },
      ]),
      'map-reduce',
    );
    expect(outcome.costUsd).toBeNull();
    expect(outcome.costSource).toBeNull();
  });

  it("a provider that reports a cost but no source is never claimed as 'api'", async () => {
    const outcome = await run(stubLlm([{ review: review(), costUsd: 0.5 }]));
    expect(outcome.costSource).toBe('estimate');
  });
});
