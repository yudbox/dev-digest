/**
 * Integration tests for POST /multi-agent-runs/:id/aggregate
 * (Testcontainers Postgres — real DB, MockLLMProvider)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startPg,
  dockerAvailable,
  type PgFixture,
} from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AggregateResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('POST /multi-agent-runs/:id/aggregate (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'aggregate-test-repo',
        fullName: 'acme/aggregate-test-repo',
      })
      .returning();
    repoId = repo!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * Build a Fastify app with a MockLLMProvider for the given fixture.
   */
  function appWith(fixture?: unknown) {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        LlmAggregateResponse: fixture ?? {
          groups: [],
        },
      },
    });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm } },
    });
  }

  /**
   * Create a complete multi-agent run with findings in the DB.
   * Returns the multi-agent run's id.
   */
  async function createMultiAgentRun(opts: {
    findingCount?: number;
    status?: 'done' | 'failed' | 'running';
  } = {}): Promise<string> {
    const { findingCount = 1, status = 'done' } = opts;
    const db = pg.handle.db;

    // Create a PR
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: Math.floor(Math.random() * 100_000),
        title: 'Test PR',
        author: 'dev',
        branch: 'feature',
        base: 'main',
        headSha: 'abc123',
      })
      .returning();

    // Create an agent
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        repoId,
        name: `Aggregate Test Agent ${Date.now()}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review this',
        enabled: true,
        strategy: 'single-pass',
      })
      .returning();

    // Create a multi_agent_runs row
    const [mar] = await db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: pr!.id })
      .returning();

    // Create an agent_run row
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agent!.id,
        prId: pr!.id,
        provider: 'openai',
        model: 'gpt-4.1',
        status,
        multiAgentRunId: mar!.id,
      })
      .returning();

    if (status === 'done' && findingCount > 0) {
      // Create a review row
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          runId: run!.id,
          prId: pr!.id,
          agentId: agent!.id,
          kind: 'review',
          verdict: 'request_changes',
          score: 60,
          summary: 'Issues found',
        })
        .returning();

      // Create finding rows
      for (let i = 0; i < findingCount; i++) {
        await db.insert(t.findings).values({
          reviewId: review!.id,
          severity: 'WARNING',
          category: 'bug',
          title: `Finding ${i + 1}`,
          file: `src/file.ts`,
          startLine: i * 5 + 1,
          endLine: i * 5 + 3,
          rationale: 'Something is wrong',
          suggestion: 'Fix it',
          confidence: 0.9,
          kind: 'finding',
        });
      }
    }

    return mar!.id;
  }

  /**
   * Configure the workspace to have an openai model set for review_intent.
   */
  async function setFeatureModel() {
    const db = pg.handle.db;
    await db
      .insert(t.settings)
      .values({
        workspaceId,
        key: 'feature_models',
        value: { review_intent: { provider: 'openai', model: 'gpt-4.1' } },
      })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: { review_intent: { provider: 'openai', model: 'gpt-4.1' } } },
      });
  }

  it('returns 404 when multi-agent run does not exist', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/multi-agent-runs/00000000-0000-0000-0000-000000000000/aggregate',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 422 when no feature model is configured', async () => {
    // Remove feature_models settings to ensure no model is set
    await pg.handle.db
      .delete(t.settings)
      .where(
        eq(t.settings.workspaceId, workspaceId),
      );

    const runId = await createMultiAgentRun({ findingCount: 1 });
    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: `/multi-agent-runs/${runId}/aggregate`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { message: string } }>().error.message).toContain(
      'No model selected',
    );
  });

  it('returns 200 with valid AggregateResponse when run has done-column findings', async () => {
    await setFeatureModel();
    const runId = await createMultiAgentRun({ findingCount: 1 });

    const llmFixture = {
      groups: [
        {
          finding_ids: [], // finding ids from DB unknown to us here — will be empty after grounding
          title: 'Test issue',
          reviewer_comment: 'Fix this.\n\n---\n\nИсправьте.',
        },
      ],
    };

    const app = await appWith(llmFixture);
    const res = await app.inject({
      method: 'POST',
      url: `/multi-agent-runs/${runId}/aggregate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<AggregateResponse>();
    expect(body.multi_agent_run_id).toBe(runId);
    expect(body.source_findings_total).toBe(1);
    expect(typeof body.generated_at).toBe('string');
    expect(body.model).toContain('openai');
  });

  it('returns empty groups when the run has no done-column findings', async () => {
    await setFeatureModel();
    const runId = await createMultiAgentRun({ status: 'failed' });
    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: `/multi-agent-runs/${runId}/aggregate`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AggregateResponse>();
    expect(body.groups).toEqual([]);
    expect(body.source_findings_total).toBe(0);
  });
});
