import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';

/**
 * TASK-004 (bonus, out of L06 grading rubric) — `AgentsRepository.statsForWorkspace()`.
 *
 * Agents are seeded directly via Drizzle rather than `POST /agents` — same
 * pre-existing, unrelated `repo_id` bug documented in `evals.it.test.ts`.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('A2 bonus: agent list stats (Testcontainers pg)', () => {
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
      .values({ workspaceId, owner: 'acme', name: 'agents-stats-repo', fullName: 'acme/agents-stats-repo' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-017: GET /agents attaches runs_count/accept_rate_pct/avg_cost_usd via one batched stats query (finding-level accept rate)', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });

    const [agentA] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        repoId,
        name: 'Stats Agent A',
        provider: 'openai',
        model: 'm',
        systemPrompt: 's',
      })
      .returning();
    const [agentB] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        repoId,
        name: 'Stats Agent B (no runs)',
        provider: 'openai',
        model: 'm',
        systemPrompt: 's',
      })
      .returning();

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1,
        title: 'PR',
        author: 'dev',
        branch: 'b',
        base: 'main',
        headSha: 'x',
        status: 'needs_review',
      })
      .returning();

    // Two runs for agent A: costs 2.0 and null (avg over non-null = 2.0, not 1.0).
    const [runA1] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agentA!.id, prId: pr!.id, costUsd: 2.0, status: 'done' })
      .returning();
    const [runA2] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agentA!.id, prId: pr!.id, costUsd: null, status: 'done' })
      .returning();

    const [reviewA1] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId: agentA!.id, runId: runA1!.id, kind: 'review' as const })
      .returning();
    const [reviewA2] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId: agentA!.id, runId: runA2!.id, kind: 'review' as const })
      .returning();

    // 3 resolved findings (2 accepted, 1 dismissed) + 1 unresolved (excluded
    // from the denominator) → accept_rate_pct = round(2/3 * 100) = 67.
    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: reviewA1!.id,
        file: 'a.ts',
        startLine: 1,
        endLine: 1,
        severity: 'WARNING',
        category: 'bug',
        title: 't1',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      },
      {
        reviewId: reviewA1!.id,
        file: 'a.ts',
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'bug',
        title: 't2',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      },
      {
        reviewId: reviewA2!.id,
        file: 'a.ts',
        startLine: 3,
        endLine: 3,
        severity: 'WARNING',
        category: 'bug',
        title: 't3',
        rationale: 'r',
        confidence: 0.9,
        dismissedAt: new Date(),
      },
      {
        reviewId: reviewA2!.id,
        file: 'a.ts',
        startLine: 4,
        endLine: 4,
        severity: 'WARNING',
        category: 'bug',
        title: 't4 (unresolved)',
        rationale: 'r',
        confidence: 0.9,
      },
    ]);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    const dtoA = list.find((a: { id: string }) => a.id === agentA!.id);
    const dtoB = list.find((a: { id: string }) => a.id === agentB!.id);

    expect(dtoA.runs_count).toBe(2);
    expect(dtoA.accept_rate_pct).toBe(67);
    expect(dtoA.avg_cost_usd).toBe(2.0);

    // Agent with zero runs degrades to zeros/null, not undefined/NaN.
    expect(dtoB.runs_count).toBe(0);
    expect(dtoB.accept_rate_pct).toBe(0);
    expect(dtoB.avg_cost_usd).toBeNull();

    // Single-agent GET agrees with the list view.
    const single = (await app.inject({ method: 'GET', url: `/agents/${agentA!.id}` })).json();
    expect(single.runs_count).toBe(2);
    expect(single.accept_rate_pct).toBe(67);
    expect(single.avg_cost_usd).toBe(2.0);

    await app.close();
  });
});
