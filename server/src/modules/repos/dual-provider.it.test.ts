/**
 * TASK-011 (SPEC-2026-08-25-azure-devops-integration, Фаза 7/AC-011-1) —
 * mixed dual-provider regression: a GitHub repo and an Azure DevOps repo
 * coexisting in the SAME workspace, with concurrent operations over both.
 * `Container.vcs(repo)` dispatches per repo row (`repos.vcs_provider`), not
 * via any global "current provider" flag (R53) — this suite proves that by
 * running GitHub and ADO calls interleaved and asserting neither leaks into
 * the other's result.
 *
 * Hermetic: `git`/`vcs` are mocked (`MockGitClient`/`MockVcsClient`); the
 * secrets provider is an explicit `MockSecretsProvider` with fake PAT values
 * so this suite never reads (or could leak) the real local
 * `~/.devdigest/secrets.json`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPg, dockerAvailable, type PgFixture } from "../../../test/helpers/pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { seed } from "../../db/seed.js";
import { MockGitClient, MockVcsClient, MockSecretsProvider } from "../../adapters/mocks.js";
import type { PrMeta } from "@devdigest/shared";

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

/** Fake PAT values — never the real local secrets, and never asserted on. */
const secrets = () =>
  new MockSecretsProvider({
    GITHUB_TOKEN: "mock-gh-pat",
    AZURE_DEVOPS_TOKEN: "mock-ado-pat",
  });

d("dual-provider regression — GitHub + Azure DevOps in one workspace (TASK-011)", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("adds a GitHub repo and an Azure DevOps repo in the same workspace with distinct vcs_provider values", async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        vcs: { github: new MockVcsClient(), "azure-devops": new MockVcsClient({}, "azure-devops") },
        secrets: secrets(),
      },
    });

    const gh = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { url: "https://github.com/acme/dual-provider-repo" },
    });
    expect(gh.statusCode).toBe(201);
    expect(gh.json().vcs_provider).toBe("github");
    expect(gh.json().full_name).toBe("acme/dual-provider-repo");

    const ado = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { url: "https://dev.azure.com/acme/Payments/_git/dual-provider-repo" },
    });
    expect(ado.statusCode).toBe(201);
    expect(ado.json().vcs_provider).toBe("azure-devops");
    expect(ado.json().full_name).toBe("acme/Payments/dual-provider-repo");
    expect(ado.json().id).not.toBe(gh.json().id);

    await app.container.jobs.onIdle();
    await app.close();
  });

  it("GET /repos lists both providers' repos together, each tagged with its own vcs_provider", async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        vcs: { github: new MockVcsClient(), "azure-devops": new MockVcsClient({}, "azure-devops") },
        secrets: secrets(),
      },
    });

    await app.inject({
      method: "POST",
      url: "/repos",
      payload: { url: "https://github.com/acme/listed-gh-repo" },
    });
    await app.inject({
      method: "POST",
      url: "/repos",
      payload: { url: "https://dev.azure.com/acme/Payments/_git/listed-ado-repo" },
    });

    const list = await app.inject({ method: "GET", url: "/repos" });
    expect(list.statusCode).toBe(200);
    const rows = list.json() as { full_name: string; vcs_provider: string }[];
    expect(rows.find((r) => r.full_name === "acme/listed-gh-repo")?.vcs_provider).toBe("github");
    expect(rows.find((r) => r.full_name === "acme/Payments/listed-ado-repo")?.vcs_provider).toBe(
      "azure-devops",
    );

    await app.container.jobs.onIdle();
    await app.close();
  });

  it("concurrent GET /repos/:id/pulls for a GitHub repo and an ADO repo dispatch to each provider's own VcsClient — no cross-provider bleed (R53)", async () => {
    // Two DISTINCT mock clients with DELIBERATELY DIFFERENT fixtures — if
    // `Container.vcs()` ever dispatched by anything other than the repo row's
    // own `vcs_provider` (e.g. a shared "last used provider" flag), one of
    // these two concurrent calls would come back with the WRONG provider's
    // fixture PR title.
    const ghPr: PrMeta = {
      number: 1,
      title: "GITHUB-ONLY-FIXTURE",
      author: "gh-author",
      branch: "feat/gh",
      base: "main",
      head_sha: "ghsha1",
      additions: 1,
      deletions: 0,
      files_count: 1,
      status: "open",
    };
    const adoPr: PrMeta = {
      number: 2,
      title: "ADO-ONLY-FIXTURE",
      author: "ado-author",
      branch: "feat/ado",
      base: "main",
      head_sha: "adosha1",
      additions: 1,
      deletions: 0,
      files_count: 1,
      status: "open",
    };
    const mockGh = new MockVcsClient({ pulls: [ghPr] });
    const mockAdo = new MockVcsClient({ pulls: [adoPr] }, "azure-devops");

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        vcs: { github: mockGh, "azure-devops": mockAdo },
        secrets: secrets(),
      },
    });

    const ghRepo = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { url: "https://github.com/acme/concurrent-gh-repo" },
    });
    const adoRepo = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { url: "https://dev.azure.com/acme/Payments/_git/concurrent-ado-repo" },
    });
    await app.container.jobs.onIdle();

    // Fired concurrently (not awaited sequentially) so any shared/cached
    // provider-selection state would have to race to leak.
    const [ghPulls, adoPulls] = await Promise.all([
      app.inject({ method: "GET", url: `/repos/${ghRepo.json().id}/pulls` }),
      app.inject({ method: "GET", url: `/repos/${adoRepo.json().id}/pulls` }),
    ]);

    expect(ghPulls.statusCode).toBe(200);
    expect(adoPulls.statusCode).toBe(200);
    const ghTitles = (ghPulls.json() as PrMeta[]).map((p) => p.title);
    const adoTitles = (adoPulls.json() as PrMeta[]).map((p) => p.title);
    expect(ghTitles).toContain("GITHUB-ONLY-FIXTURE");
    expect(ghTitles).not.toContain("ADO-ONLY-FIXTURE");
    expect(adoTitles).toContain("ADO-ONLY-FIXTURE");
    expect(adoTitles).not.toContain("GITHUB-ONLY-FIXTURE");

    await app.container.jobs.onIdle();
    await app.close();
  });
});
