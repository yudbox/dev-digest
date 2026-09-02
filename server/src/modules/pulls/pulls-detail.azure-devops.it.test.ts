import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPg, dockerAvailable, type PgFixture } from "../../../test/helpers/pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { seed } from "../../db/seed.js";
import { LocalSecretsProvider } from "../../adapters/secrets/local.js";
import { SimpleGitClient } from "../../adapters/git/simple-git.js";
import { buildCloneUrl, withVcsToken } from "../repos/helpers.js";
import * as t from "../../db/schema.js";
import { PrDetail } from "@devdigest/shared";

/**
 * TASK-007 — end-to-end verification of the critical diff-path (AC-007-1,
 * AC-007-6) via the ACTUAL `GET /pulls/:id` HTTP route, against the real
 * Azure DevOps project used throughout this plan (org GES-IT, project
 * Big_Commerce_Remediation, repo ges-azure-functions, PR #6327). No mocks:
 * `buildApp()` is given NO `overrides`, so the request hits the real
 * `AzureDevOpsClient` (real REST calls) and the real `SimpleGitClient` (real
 * clone/fetch/diff on disk) — exactly the production code path.
 *
 * Per the plan/spec: mock tests alone are not sufficient for this path
 * ("mock-тестов недостаточно").
 *
 * SECURITY: the PAT is read ONLY via `LocalSecretsProvider` (just to decide
 * whether to skip this suite) — the actual request flow reads it itself,
 * server-side, exactly as production does. The PAT is never asserted on,
 * logged, or written anywhere in this file.
 */
const ORG = "GES-IT";
const PROJECT = "Big_Commerce_Remediation";
const REPO_NAME = "ges-azure-functions";
const PR_NUMBER = 6327;
const BASE_URL = "https://dev.azure.com";

const hasDocker = await dockerAvailable();
const config = loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
const secrets = new LocalSecretsProvider(config.secretsPath);
const pat = await secrets.get("AZURE_DEVOPS_TOKEN");

const d = hasDocker && pat ? describe : describe.skip;

d("GET /pulls/:id — real Azure DevOps diff-first path (TASK-007)", () => {
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

  it(
    "every file in the response has a non-empty patch; PrDetail.parse() accepts it (AC-007-6)",
    async () => {
      const app = await buildApp({ config, db: pg.handle.db });

      // Ensure the clone exists on disk (idempotent — a prior run's clone is
      // fetched, not re-cloned) and record its real path on the repo row,
      // exactly as `CLONE_JOB_KIND`'s handler would in production. The
      // detail route's own diff-first loader (`tryLoadLocalDiff`) then
      // fetches the PR head on demand before diffing — this test does not
      // pre-fetch the PR ref itself, only the base clone.
      const git = new SimpleGitClient(config.cloneDir);
      const rawUrl = buildCloneUrl({
        vcsProvider: "azure-devops",
        owner: ORG,
        name: REPO_NAME,
        project: PROJECT,
        baseUrl: BASE_URL,
      });
      const authedUrl = withVcsToken(rawUrl, "azure-devops", pat!);
      const cloneRepoRef: Parameters<typeof git.clone>[0] & { provider: "azure-devops" } = {
        provider: "azure-devops",
        owner: ORG,
        project: PROJECT,
        name: REPO_NAME,
      };
      const { path: clonePath } = await git.clone(cloneRepoRef, authedUrl, { depth: 1 });

      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({
          workspaceId,
          vcsProvider: "azure-devops",
          owner: ORG,
          project: PROJECT,
          baseUrl: BASE_URL,
          name: REPO_NAME,
          fullName: `${ORG}/${PROJECT}/${REPO_NAME}`,
          clonePath,
        })
        .returning();

      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId: repo!.id,
          number: PR_NUMBER,
          title: "real ADO PR",
          author: "unknown",
          branch: "unknown",
          base: "unknown",
          headSha: "0000000000000000000000000000000000000000",
          additions: 0,
          deletions: 0,
          filesCount: 0,
          status: "open",
        })
        .returning();

      const res = await app.inject({ method: "GET", url: `/pulls/${pr!.id}` });
      expect(res.statusCode).toBe(200);

      const parsed = PrDetail.parse(res.json());
      expect(parsed.files.length).toBeGreaterThan(0);
      for (const f of parsed.files) {
        expect(f.patch).toBeTruthy();
        expect(typeof f.patch).toBe("string");
        expect((f.patch as string).length).toBeGreaterThan(0);
      }
      // With a real, successfully-computed diff, there is nothing to report
      // as unavailable.
      expect(parsed.diff_unavailable).toBeFalsy();

      await app.close();
    },
    120_000,
  );
});
