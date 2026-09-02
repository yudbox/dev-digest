import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { MultiAgentRun } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Mock ReviewRepository so we don't need a real DB
// ---------------------------------------------------------------------------

const mockGetMultiAgentRunById = vi.fn();
const mockGetPull = vi.fn();

vi.mock('./repository.js', () => ({
  ReviewRepository: vi.fn().mockImplementation(() => ({
    getMultiAgentRunById: mockGetMultiAgentRunById,
    getPull: mockGetPull,
  })),
}));

const { AggregateService } = await import('./aggregate-service.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-1';
const RUN_ID = 'run-abc';

function makeRun(overrides: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: RUN_ID,
    pr_id: 'pr-1',
    pr_number: 42,
    pr_title: 'Test PR',
    ran_at: new Date().toISOString(),
    agent_count: 2,
    total_duration_ms: 1000,
    total_cost_usd: 0.01,
    columns: [
      {
        run_id: 'run-1',
        agent_id: 'a1',
        agent_name: 'Security Bot',
        provider: 'openai',
        model: 'gpt-4o',
        status: 'done',
        verdict: 'request_changes',
        score: 60,
        summary: 'Found issues',
        duration_ms: 500,
        cost_usd: 0.005,
        findings: [
          {
            id: 'f1',
            severity: 'CRITICAL',
            category: 'security',
            title: 'Auth missing',
            file: 'src/auth.ts',
            start_line: 10,
            end_line: 12,
            rationale: 'No auth check',
            suggestion: 'Add auth middleware',
            confidence: 0.9,
            kind: 'finding',
          },
          {
            id: 'f2',
            severity: 'WARNING',
            category: 'bug',
            title: 'NPE risk',
            file: 'src/auth.ts',
            start_line: 15,
            end_line: 18,
            rationale: 'Null not handled',
            suggestion: null,
            confidence: 0.8,
            kind: 'finding',
          },
        ],
      },
    ],
    conflicts: [],
    ...overrides,
  } as unknown as MultiAgentRun;
}

function makeContainer(opts: {
  settingsRows?: object[];
  llmProvider?: MockLLMProvider;
} = {}): Container {
  const settingsRows = opts.settingsRows ?? [
    {
      key: 'feature_models',
      value: { review_intent: { provider: 'openai', model: 'gpt-4.1' } },
    },
  ];
  const llm = opts.llmProvider ?? new MockLLMProvider('openai', {
    structuredBySchema: {
      LlmAggregateResponse: {
        groups: [
          {
            finding_ids: ['f1', 'f2'],
            title: 'Auth and NPE issues',
            reviewer_comment: 'Fix auth.\n\n---\n\nИсправьте.',
          },
        ],
      },
    },
  });

  return {
    db: {
      select: () => ({
        from: () => ({
          where: async () => settingsRows,
        }),
      }),
    },
    llm: vi.fn().mockResolvedValue(llm),
  } as unknown as Container;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetMultiAgentRunById.mockReset();
  mockGetPull.mockReset();
});

describe('AggregateService.aggregate', () => {
  it('throws NotFoundError when run does not exist', async () => {
    mockGetMultiAgentRunById.mockResolvedValue(null);
    const svc = new AggregateService(makeContainer());
    await expect(svc.aggregate(WORKSPACE_ID, RUN_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when run exists but belongs to another workspace', async () => {
    mockGetMultiAgentRunById.mockResolvedValue(makeRun());
    mockGetPull.mockResolvedValue(null); // workspace mismatch → not found
    const svc = new AggregateService(makeContainer());
    await expect(svc.aggregate(WORKSPACE_ID, RUN_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when source findings exceed AGGREGATE_MAX_FINDINGS', async () => {
    // Create a run with 61 findings from one done column
    const manyFindings = Array.from({ length: 61 }, (_, i) => ({
      id: `f${i}`,
      severity: 'WARNING',
      category: 'bug',
      title: `Finding ${i}`,
      file: `src/file${i}.ts`,
      start_line: i + 1,
      end_line: i + 2,
      rationale: 'reason',
      suggestion: null,
      confidence: 0.5,
      kind: 'finding',
      review_id: 'r1',
    }));
    const run = makeRun({
      columns: [
        {
          run_id: 'run-1', agent_id: 'a1', agent_name: 'A',
          provider: 'openai', model: 'gpt-4.1',
          status: 'done', verdict: null, score: null, summary: null,
          duration_ms: null, cost_usd: null,
          findings: manyFindings,
        },
      ] as MultiAgentRun['columns'],
    });
    mockGetMultiAgentRunById.mockResolvedValue(run);
    mockGetPull.mockResolvedValue({ id: 'pr-1' });
    const svc = new AggregateService(makeContainer());
    await expect(svc.aggregate(WORKSPACE_ID, RUN_ID)).rejects.toThrow(ValidationError);
  });

  it('returns empty groups immediately when no findings in done columns', async () => {
    const run = makeRun({
      columns: [
        {
          run_id: 'run-1', agent_id: 'a1', agent_name: 'A',
          provider: 'openai', model: null,
          status: 'failed', verdict: null, score: null, summary: null,
          duration_ms: null, cost_usd: null, findings: [],
        },
      ] as unknown as MultiAgentRun['columns'],
    });
    mockGetMultiAgentRunById.mockResolvedValue(run);
    mockGetPull.mockResolvedValue({ id: 'pr-1' });
    const svc = new AggregateService(makeContainer());
    const result = await svc.aggregate(WORKSPACE_ID, RUN_ID);
    expect(result.groups).toEqual([]);
    expect(result.source_findings_total).toBe(0);
    expect(result.model).toBe('none');
  });

  it('throws ValidationError when no feature model is configured', async () => {
    mockGetMultiAgentRunById.mockResolvedValue(makeRun());
    mockGetPull.mockResolvedValue({ id: 'pr-1' });
    const container = makeContainer({ settingsRows: [] }); // no settings → no model override
    const svc = new AggregateService(container);
    await expect(svc.aggregate(WORKSPACE_ID, RUN_ID)).rejects.toThrow(ValidationError);
  });

  it('returns a valid AggregateResponse with groups from LLM', async () => {
    const run = makeRun();
    mockGetMultiAgentRunById.mockResolvedValue(run);
    mockGetPull.mockResolvedValue({ id: 'pr-1' });
    const svc = new AggregateService(makeContainer());
    const result = await svc.aggregate(WORKSPACE_ID, RUN_ID);

    expect(result.multi_agent_run_id).toBe(RUN_ID);
    expect(result.source_findings_total).toBe(2);
    expect(result.model).toContain('openai');
    expect(result.groups).toHaveLength(1);

    const g = result.groups[0]!;
    expect(g.severity).toBe('CRITICAL'); // max of CRITICAL + WARNING
    expect(g.category).toBe('security'); // from the CRITICAL finding
    expect(g.title).toBe('Auth and NPE issues');
    expect(g.sources).toHaveLength(2);
    expect(g.file).toBe('src/auth.ts');
  });

  it('drops malformed LLM group elements without throwing', async () => {
    const run = makeRun();
    mockGetMultiAgentRunById.mockResolvedValue(run);
    mockGetPull.mockResolvedValue({ id: 'pr-1' });

    const badLlm = new MockLLMProvider('openai', {
      structuredBySchema: {
        LlmAggregateResponse: {
          groups: [
            // valid group
            { finding_ids: ['f1'], title: 'Good', reviewer_comment: 'C\n\n---\n\nR' },
            // malformed — missing required fields
            { finding_ids: [] }, // fails min(1) on finding_ids
            { title: 'No ids' },  // missing finding_ids entirely
          ],
        },
      },
    });

    const container = makeContainer({ llmProvider: badLlm });
    const svc = new AggregateService(container);
    const result = await svc.aggregate(WORKSPACE_ID, RUN_ID);
    // Only the valid group survives
    expect(result.groups).toHaveLength(1);
  });

  it('does not call LLM when findings list is empty', async () => {
    const run = makeRun({
      columns: [] as MultiAgentRun['columns'],
    });
    mockGetMultiAgentRunById.mockResolvedValue(run);
    mockGetPull.mockResolvedValue({ id: 'pr-1' });
    const container = makeContainer();
    const svc = new AggregateService(container);
    await svc.aggregate(WORKSPACE_ID, RUN_ID);
    // container.llm should not have been called
    expect(container.llm).not.toHaveBeenCalled();
  });
});
