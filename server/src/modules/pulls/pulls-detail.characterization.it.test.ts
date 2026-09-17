/**
 * TASK-000 characterization baseline (Azure DevOps integration plan, P3): pins
 * the CURRENT GitHub-only detail/comments behaviour of the pulls module
 * BEFORE the diff-first-loader refactor (TASK-007) touches
 * `pulls/routes.ts:277-295` and before the `GitHubClient → VcsClient`
 * refactor lands. Per server/insights/INSIGHTS.md:159, `GET /pulls/:id`
 * currently persists `detail.files[].patch` straight from the provider
 * response — this suite locks in that every file in the response has a
 * non-empty `patch` for a GitHub PR (via MockGitHubClient), so any later
 * regression from wiring in the shared diff-first loader is caught
 * immediately (AC-54 / AC-007-2).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { PrDetail, PrReviewComment } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `char-detail-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 42,
      title: 'Characterization baseline PR',
      author: 'marisa.koch',
      branch: 'feat/baseline',
      base: 'main',
      headSha: 'cafebabe',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

const EXISTING_COMMENT: PrReviewComment = {
  id: 1,
  path: 'src/config.ts',
  line: 11,
  original_line: 11,
  side: 'RIGHT',
  body: 'Existing baseline comment',
  user: 'reviewer',
  created_at: '2026-06-01T00:00:00Z',
  html_url: 'https://github.com/acme/x/pull/42#discussion_r1',
  in_reply_to_id: null,
  is_outdated: false,
};

d('pulls detail + comments characterization baseline — GitHub path (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('GET /pulls/:id returns a PrDetail whose files all have a non-empty patch', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);

    const detail = res.json() as PrDetail;
    expect(detail.files.length).toBeGreaterThan(0);
    for (const f of detail.files) {
      expect(f.patch).toBeTruthy();
      expect(typeof f.patch).toBe('string');
      expect((f.patch as string).length).toBeGreaterThan(0);
    }

    await app.close();
  });

  it('GET /pulls/:id/comments reflects existing GitHub review comments', async () => {
    const gh = new MockGitHubClient({ comments: [EXISTING_COMMENT] });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/comments` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrReviewComment[];
    expect(body).toHaveLength(1);
    expect(body[0]!.body).toBe('Existing baseline comment');

    await app.close();
  });

  it('POST /pulls/:id/comments creates a comment pinned to the PR head sha', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'Baseline comment body.' },
    });
    expect(res.statusCode).toBe(200);
    expect(gh.createdComments).toHaveLength(1);
    expect(gh.createdComments[0]).toMatchObject({
      commitId: 'cafebabe',
      path: 'src/config.ts',
      line: 11,
      body: 'Baseline comment body.',
    });

    const created = res.json() as PrReviewComment;
    expect(created.path).toBe('src/config.ts');
    expect(created.line).toBe(11);

    await app.close();
  });
});
