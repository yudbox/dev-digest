import { describe, it, expect } from "vitest";
import { simpleGit } from "simple-git";
import type * as t from "../../../db/schema.js";
import type { Db } from "../../../db/client.js";
import { Container } from "../../../platform/container.js";
import { loadConfig } from "../../../platform/config.js";
import { LocalSecretsProvider } from "../../../adapters/secrets/local.js";
import { buildCloneUrl, withVcsToken } from "../../repos/helpers.js";
import { tryLoadLocalDiff } from "./diff-loader.js";
import { splitUnifiedDiffByFile } from "./split-by-file.js";

/**
 * TASK-007 — real-API/real-clone verification of the critical diff-path
 * (AC-007-1/AC-007-3/AC-007-5/AC-007-7) against the actual Azure DevOps
 * project used throughout this plan (org GES-IT, project
 * Big_Commerce_Remediation, repo ges-azure-functions, PR #6327). Per the
 * plan/spec, mock tests alone are not sufficient for this path.
 *
 * Exercises the REAL production code path end to end:
 * `LocalSecretsProvider.get('AZURE_DEVOPS_TOKEN')` → `withVcsToken` →
 * `Container.git.clone()`/`tryLoadLocalDiff()` (which itself calls
 * `container.git.fetchPullHead()` before diffing — the "fetch on demand"
 * behavior AC-007-3 requires, exercised on every run of this test regardless
 * of whether the ref already existed locally from a prior run).
 *
 * SECURITY: the PAT is read ONLY via `LocalSecretsProvider.get()`, used
 * strictly in-memory to build an authenticated clone URL, and NEVER logged,
 * asserted on, or written anywhere. `LocalSecretsProvider.set()` is never
 * called. Skipped (not failed) when no `AZURE_DEVOPS_TOKEN` is configured.
 */
const ORG = "GES-IT";
const PROJECT = "Big_Commerce_Remediation";
const REPO = "ges-azure-functions";
const PR_NUMBER = 6327;
const BASE_URL = "https://dev.azure.com";

const config = loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
const secrets = new LocalSecretsProvider(config.secretsPath);
const pat = await secrets.get("AZURE_DEVOPS_TOKEN");

const d = pat ? describe : describe.skip;

d("tryLoadLocalDiff — real Azure DevOps clone + diff (TASK-007)", () => {
  it(
    "computes a real local diff for PR #6327 whose split patches all start with @@ and contain no diff --git",
    async () => {
      // `{}` stands in for `Db` — `tryLoadLocalDiff` never touches
      // `container.db`/`container.jobs`/`container.auth`, only
      // `container.secrets` and `container.git`, both of which work off the
      // real config without a real DB connection.
      const container = new Container(config, {} as unknown as Db);

      const rawUrl = buildCloneUrl({
        vcsProvider: "azure-devops",
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
      });
      const authedUrl = withVcsToken(rawUrl, "azure-devops", pat!);

      // Ensure the clone exists (idempotent — a prior run's clone is
      // fetched, not re-cloned). Mirrors what `CLONE_JOB_KIND`'s handler
      // does in production (server/clones/azure-devops/GES-IT/...).
      const cloneRepoRef: Parameters<typeof container.git.clone>[0] & { provider: "azure-devops" } = {
        provider: "azure-devops",
        owner: ORG,
        project: PROJECT,
        name: REPO,
      };
      const { path: clonePath } = await container.git.clone(cloneRepoRef, authedUrl, { depth: 1 });

      const repoRow = {
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
        vcsProvider: "azure-devops",
        clonePath,
      } as unknown as typeof t.repos.$inferSelect;

      const result = await tryLoadLocalDiff(container, repoRow, {
        number: PR_NUMBER,
        base: "irrelevant-for-azure-devops", // ADO diffing uses pr-{n}^1/^2, not this
        headSha: "irrelevant-for-azure-devops",
      });

      expect(result.unavailableReason).toBeNull();
      expect(result.diff).not.toBeNull();
      expect(result.diff!.files.length).toBeGreaterThan(0);

      const splitPatches = splitUnifiedDiffByFile(result.diff!.raw);
      expect(splitPatches.size).toBeGreaterThan(0);
      for (const patch of splitPatches.values()) {
        expect(patch.startsWith("@@")).toBe(true);
        expect(patch).not.toContain("diff --git");
      }

      // AC-007-7 — per-file additions/deletions come from the real local
      // diff (parseUnifiedDiff's own line-counting), not fabricated values.
      for (const f of result.diff!.files) {
        expect(f.additions).toBeGreaterThanOrEqual(0);
        expect(f.deletions).toBeGreaterThanOrEqual(0);
      }
    },
    120_000,
  );

  it(
    "AC-007-3: fetches the PR head on demand even when the local pr-{n} ref was deleted since the last run",
    async () => {
      const container = new Container(config, {} as unknown as Db);
      const rawUrl = buildCloneUrl({
        vcsProvider: "azure-devops",
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
      });
      const authedUrl = withVcsToken(rawUrl, "azure-devops", pat!);
      const cloneRepoRef: Parameters<typeof container.git.clone>[0] & { provider: "azure-devops" } = {
        provider: "azure-devops",
        owner: ORG,
        project: PROJECT,
        name: REPO,
      };
      const { path: clonePath } = await container.git.clone(cloneRepoRef, authedUrl, { depth: 1 });

      // Simulate "head absent locally" (e.g. a stale/never-fetched clone) by
      // deleting the local ref a prior run may have left behind. Deleting the
      // ref (not the whole clone) isolates this test to AC-007-3's specific
      // claim — the detail route must fetch on demand, not merely happen to
      // already have the ref cached from setup.
      const raw = simpleGit(clonePath);
      await raw.raw(["update-ref", "-d", `refs/heads/pr-${PR_NUMBER}`]).catch(() => undefined);
      await expect(raw.revparse([`pr-${PR_NUMBER}`])).rejects.toThrow();

      const repoRow = {
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
        vcsProvider: "azure-devops",
        clonePath,
      } as unknown as typeof t.repos.$inferSelect;

      const result = await tryLoadLocalDiff(container, repoRow, {
        number: PR_NUMBER,
        base: "irrelevant-for-azure-devops",
        headSha: "irrelevant-for-azure-devops",
      });

      expect(result.unavailableReason).toBeNull();
      expect(result.diff).not.toBeNull();
      expect(result.diff!.files.length).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "AC-007-7: per-file additions/deletions exactly match `git diff --numstat` for the same PR",
    async () => {
      const container = new Container(config, {} as unknown as Db);
      const rawUrl = buildCloneUrl({
        vcsProvider: "azure-devops",
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
      });
      const authedUrl = withVcsToken(rawUrl, "azure-devops", pat!);
      const cloneRepoRef: Parameters<typeof container.git.clone>[0] & { provider: "azure-devops" } = {
        provider: "azure-devops",
        owner: ORG,
        project: PROJECT,
        name: REPO,
      };
      const { path: clonePath } = await container.git.clone(cloneRepoRef, authedUrl, { depth: 1 });
      const repoRow = {
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
        vcsProvider: "azure-devops",
        clonePath,
      } as unknown as typeof t.repos.$inferSelect;

      const result = await tryLoadLocalDiff(container, repoRow, {
        number: PR_NUMBER,
        base: "irrelevant-for-azure-devops",
        headSha: "irrelevant-for-azure-devops",
      });
      expect(result.diff).not.toBeNull();

      // Independently-computed reference via raw `git diff --numstat` on the
      // SAME three-dot refspec `tryLoadLocalDiff` uses internally
      // (`pr-{n}^1...pr-{n}^2`) — the exact command AC-007-7 names.
      const raw = simpleGit(clonePath);
      const numstat = await raw.raw(["diff", "--numstat", `pr-${PR_NUMBER}^1...pr-${PR_NUMBER}^2`]);
      const expected = new Map<string, { additions: number; deletions: number }>();
      for (const line of numstat.split("\n")) {
        const m = line.match(/^(\d+)\t(\d+)\t(.+)$/);
        if (!m) continue;
        expected.set(m[3]!, { additions: Number(m[1]), deletions: Number(m[2]) });
      }
      expect(expected.size).toBeGreaterThan(0);

      for (const f of result.diff!.files) {
        const ref = expected.get(f.path);
        expect(ref, `no --numstat entry for ${f.path}`).toBeDefined();
        expect(f.additions).toBe(ref!.additions);
        expect(f.deletions).toBe(ref!.deletions);
      }
    },
    120_000,
  );

  it(
    "AC-007-4: a clone_path-less repo row degrades to clone_missing without any network/git call",
    async () => {
      const container = new Container(config, {} as unknown as Db);
      const repoRow = {
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
        vcsProvider: "azure-devops",
        clonePath: null,
      } as unknown as typeof t.repos.$inferSelect;

      const result = await tryLoadLocalDiff(container, repoRow, {
        number: PR_NUMBER,
        base: "main",
        headSha: "deadbeef",
      });

      expect(result.diff).toBeNull();
      expect(result.unavailableReason).toBe("clone_missing");
    },
    10_000,
  );
});
