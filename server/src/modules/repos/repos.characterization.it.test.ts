/**
 * TASK-000 characterization baseline (Azure DevOps integration plan, P3): pins
 * the CURRENT GitHub-only behaviour of the repos module BEFORE the
 * `GitHubClient → VcsClient` refactor lands. `server/src/modules/repos/` had
 * zero test files prior to this — this is that baseline. Once the port
 * refactor (TASK-001/002/004) lands, this suite must stay green unmodified
 * (AC-54): if an assertion here needs loosening, that's a regression, not a
 * test update.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitClient, MockGitHubClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('repos characterization baseline — GitHub path (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /repos with a github.com URL persists a row with the parsed owner/name/full_name', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/characterization-repo' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.owner).toBe('acme');
    expect(body.name).toBe('characterization-repo');
    expect(body.full_name).toBe('acme/characterization-repo');

    const [row] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, body.id));
    expect(row).toBeDefined();
    expect(row!.fullName).toBe('acme/characterization-repo');

    // Drain the background clone job before tearing the app down — otherwise
    // it can still be mid-flight when `afterAll` stops the pg container,
    // producing an unrelated unhandled CONNECTION_ENDED rejection after this
    // test has already reported as passed. Matches the pattern in
    // test/integration.it.test.ts ("POST /repos persists + enqueues a clone").
    await app.container.jobs.onIdle();
    await app.close();
  });

  it('POST /repos is idempotent for the same full_name within a workspace (200, not a duplicate row)', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/dedupe-repo' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/dedupe-repo' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    const rows = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/dedupe-repo'));
    expect(rows).toHaveLength(1);

    await app.container.jobs.onIdle();
    await app.close();
  });

  it('GET /repos lists a previously-added github repo', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/listed-repo' },
    });

    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.statusCode).toBe(200);
    const names = (list.json() as { full_name: string }[]).map((r) => r.full_name);
    expect(names).toContain('acme/listed-repo');

    await app.container.jobs.onIdle();
    await app.close();
  });
});
