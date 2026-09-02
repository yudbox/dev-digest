import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPg, dockerAvailable, type PgFixture } from "../../../test/helpers/pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { seed } from "../../db/seed.js";
import { MockVcsClient } from "../../adapters/mocks.js";
import * as t from "../../db/schema.js";
import type { PrDetail } from "@devdigest/shared";

/**
 * TASK-007 (AC-007-4) — hermetic (mocked `VcsClient`, real Postgres via
 * testcontainers) coverage of the diff-unavailable degradation path, so this
 * behavior is verified in ordinary CI without requiring a real Azure DevOps
 * PAT (unlike `pulls-detail.azure-devops.it.test.ts`, which covers the
 * happy path against the real API/clone).
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

d("GET /pulls/:id — Azure DevOps repo with no clone_path degrades gracefully (AC-007-4)", () => {
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

  it("patch=null + diff_unavailable.reason='clone_missing' when repos.clone_path is unset", async () => {
    // ADO never returns patch text at all (R24) — the mock mirrors that here.
    const ado = new MockVcsClient(
      {
        detail: {
          files: [
            { path: "src/handler.ts", additions: 0, deletions: 0, patch: null },
            { path: "src/config.ts", additions: 0, deletions: 0, patch: null },
          ],
        },
      },
      "azure-devops",
    );
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { vcs: { "azure-devops": ado } },
    });

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        vcsProvider: "azure-devops",
        owner: "acme",
        project: "proj",
        baseUrl: "https://dev.azure.com",
        name: "degraded-repo",
        fullName: "acme/proj/degraded-repo",
        // clonePath intentionally omitted (null) — no clone has ever run.
      })
      .returning();

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: "degraded ADO PR",
        author: "unknown",
        branch: "feature",
        base: "main",
        headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        additions: 0,
        deletions: 0,
        filesCount: 2,
        status: "open",
      })
      .returning();

    const res = await app.inject({ method: "GET", url: `/pulls/${pr!.id}` });
    expect(res.statusCode).toBe(200);

    const body = res.json() as PrDetail;
    expect(body.files.length).toBe(2);
    for (const f of body.files) {
      expect(f.patch).toBeNull();
    }
    expect(body.diff_unavailable).toEqual({ reason: "clone_missing" });

    await app.close();
  });
});
