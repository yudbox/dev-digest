import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';

/**
 * TASK-004 (bonus, out of L06 grading rubric) — `SkillsRepository.listWithStats()`.
 *
 * Skills/agents are seeded directly via Drizzle rather than `POST /skills` /
 * `POST /agents` — same pre-existing, unrelated `repo_id` bug documented in
 * `evals.it.test.ts`.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('A1 bonus: skill list stats (Testcontainers pg)', () => {
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
      .values({ workspaceId, owner: 'acme', name: 'skills-stats-repo', fullName: 'acme/skills-stats-repo' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-018: GET /skills numbers match GET /skills/:id/stats for the same skill, computed in a batched (not per-skill) query', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });

    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        repoId,
        name: 'Batched Stats Skill',
        description: '',
        type: 'convention',
        source: 'manual',
        body: 'body',
      })
      .returning();
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        repoId,
        name: 'Skill-linked agent',
        provider: 'openai',
        model: 'm',
        systemPrompt: 's',
      })
      .returning();
    await pg.handle.db.insert(t.agentSkills).values({ agentId: agent!.id, skillId: skill!.id, order: 0 });

    const [pr1] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1,
        title: 'PR1',
        author: 'dev',
        branch: 'b1',
        base: 'main',
        headSha: 'x1',
        status: 'needs_review',
      })
      .returning();
    const [pr2] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 2,
        title: 'PR2',
        author: 'dev',
        branch: 'b2',
        base: 'main',
        headSha: 'x2',
        status: 'needs_review',
      })
      .returning();

    // 2 runs on pr1 (1 approved-verdict review), 0 runs on pr2 → pull_frequency_pct
    // = 1/2 PRs covered = 50%; accept_rate_pct = 1/2 approved runs = 50%.
    const [run1] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agent!.id, prId: pr1!.id, status: 'done' })
      .returning();
    const [run2] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agent!.id, prId: pr1!.id, status: 'done' })
      .returning();
    await pg.handle.db.insert(t.reviews).values({
      workspaceId,
      prId: pr1!.id,
      agentId: agent!.id,
      runId: run1!.id,
      kind: 'review' as const,
      verdict: 'approved',
    });
    await pg.handle.db.insert(t.reviews).values({
      workspaceId,
      prId: pr1!.id,
      agentId: agent!.id,
      runId: run2!.id,
      kind: 'review' as const,
      verdict: 'request_changes',
    });
    void pr2;

    // `seed()` may have already populated this workspace with its own demo
    // PRs, so compute the expected pull_frequency_pct dynamically (1 PR
    // covered by this test / however many PRs actually exist workspace-wide)
    // rather than assuming exactly 2.
    const { count, eq } = await import('drizzle-orm');
    const [totalRow] = await pg.handle.db
      .select({ total: count(t.pullRequests.id) })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.workspaceId, workspaceId));
    const expectedPullFrequencyPct = Math.round((1 / totalRow!.total) * 100);

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const dto = list.find((s: { id: string }) => s.id === skill!.id);
    expect(dto.agent_count).toBe(1);
    expect(dto.pull_frequency_pct).toBe(expectedPullFrequencyPct);
    expect(dto.accept_rate_pct).toBe(50);

    const single = (await app.inject({ method: 'GET', url: `/skills/${skill!.id}/stats` })).json();
    expect(single.agent_count).toBe(dto.agent_count);
    expect(single.pull_frequency_pct).toBe(dto.pull_frequency_pct);
    expect(single.accept_rate_pct).toBe(dto.accept_rate_pct);

    await app.close();
  });
});
