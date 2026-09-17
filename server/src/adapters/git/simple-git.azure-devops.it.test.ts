import { describe, it, expect, afterAll } from 'vitest';
import { simpleGit } from 'simple-git';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from './simple-git.js';
import { LocalSecretsProvider } from '../secrets/local.js';
import { withVcsToken, buildCloneUrl } from '../../modules/repos/helpers.js';
import { loadConfig } from '../../platform/config.js';

/**
 * TASK-005 (SPEC-2026-08-25-azure-devops-integration) — end-to-end clone +
 * git-auth verification against the REAL Azure DevOps repo used throughout
 * this plan (org GES-IT, project Big_Commerce_Remediation, repo
 * ges-azure-functions, PR #6327). Exercises the actual APPLICATION code path
 * (`LocalSecretsProvider.get()` — the exact class `container.secrets`
 * resolves to — → `withVcsToken` → `SimpleGitClient.clone`/`fetchPullHead`),
 * not a hand-rolled git invocation like TASK-000's spike. This both proves
 * TASK-005 and re-validates TASK-000's `refs/pull/{id}/merge` finding through
 * the real application path.
 *
 * SECURITY — read carefully before touching this file:
 *  - The PAT is read ONLY via `LocalSecretsProvider.get('AZURE_DEVOPS_TOKEN')`.
 *    It is used strictly in-memory to build an authenticated clone URL.
 *  - The PAT value is NEVER logged, NEVER interpolated into a test name or
 *    assertion message, and NEVER passed to a shell command. The "grep the
 *    clone directory for the PAT" checks below are done by reading files with
 *    Node's `fs` and comparing with `String.prototype.includes` — no
 *    subprocess is ever given the PAT as an argument or via a piped string
 *    that could show up in `ps`/shell history.
 *  - `LocalSecretsProvider.set()` is never called anywhere in this file — the
 *    real secrets file is opened strictly read-only.
 *  - This test is skipped (not failed) when no `AZURE_DEVOPS_TOKEN` is
 *    configured locally, since it requires a real, owner-provided PAT and a
 *    real network call and cannot run in ordinary CI.
 */
const ORG = 'GES-IT';
const PROJECT = 'Big_Commerce_Remediation';
const REPO = 'ges-azure-functions';
const PR_NUMBER = 6327;
const BASE_URL = 'https://dev.azure.com';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const secrets = new LocalSecretsProvider(config.secretsPath);
const pat = await secrets.get('AZURE_DEVOPS_TOKEN');

const d = pat ? describe : describe.skip;

d('SimpleGitClient — real Azure DevOps clone + PAT hygiene (TASK-005)', () => {
  let cloneDir: string | undefined;
  let cloneDir2: string | undefined;

  afterAll(async () => {
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true });
    if (cloneDir2) await rm(cloneDir2, { recursive: true, force: true });
  });

  it(
    'clones the real repo, fetches the real PR by refspec, and never persists the PAT anywhere in the clone',
    async () => {
      cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-ado-clone-'));
      const git = new SimpleGitClient(cloneDir);
      const repo = {
        provider: 'azure-devops' as const,
        owner: ORG,
        project: PROJECT,
        name: REPO,
      };

      const rawUrl = buildCloneUrl({
        vcsProvider: 'azure-devops',
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
      });
      expect(rawUrl).toBe(`${BASE_URL}/${ORG}/${PROJECT}/_git/${REPO}`);
      const authedUrl = withVcsToken(rawUrl, 'azure-devops', pat!);

      const { path } = await git.clone(repo, authedUrl, { depth: 1 });
      // AC-005-4/P2 — provider-segmented path, distinct from the GitHub scheme.
      expect(path).toBe(join(cloneDir, 'azure-devops', ORG, PROJECT, REPO));

      // AC-005-1 — `.git/config` must not contain the PAT.
      const configText = await readFile(join(path, '.git', 'config'), 'utf8');
      expect(configText.includes(pat!)).toBe(false);

      // AC-005-1 (broader) — no file anywhere in the clone directory contains it.
      const files = await listFilesRecursively(path);
      for (const file of files) {
        const content = await readFile(file, 'utf8').catch(() => '');
        expect(content.includes(pat!)).toBe(false);
      }

      // Re-validate TASK-000's spike finding end-to-end through the real
      // application code path (not a bare `git fetch` like the spike):
      // fetchPullHead() with the confirmed refs/pull/{id}/merge refspec must
      // bring a real commit locally.
      await git.fetchPullHead(repo, PR_NUMBER, authedUrl);
      const raw = simpleGit(path);
      const sha = (await raw.revparse([`pr-${PR_NUMBER}`])).trim();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const type = (await raw.raw(['cat-file', '-t', sha])).trim();
      expect(type).toBe('commit');

      // The fetch above must also leave `.git/config` PAT-free.
      const configAfterFetch = await readFile(join(path, '.git', 'config'), 'utf8');
      expect(configAfterFetch.includes(pat!)).toBe(false);
    },
    120_000,
  );

  it(
    're-fetches correctly when the local pr-{n} ref already exists and is NOT an ancestor of the current remote merge commit (non-fast-forward)',
    async () => {
      // Discovered live (2026-09-02) against real PR #6557 on this same repo:
      // when a PR receives a new commit after DevDigest's first fetch, ADO
      // regenerates `refs/pull/{n}/merge` as a brand-new synthetic merge
      // commit — NOT a fast-forward descendant of the previous one. A
      // refspec without a leading `+` makes `git fetch` REJECT the ref
      // update and throw, permanently stuck at the PR's original head. This
      // test reproduces that divergence deterministically (an orphan commit
      // has no ancestry relationship with anything) rather than depending on
      // a real second push landing on the live PR mid-test-run.
      const dir = await mkdtemp(join(tmpdir(), 'devdigest-ado-refetch-'));
      cloneDir2 = dir;
      const git = new SimpleGitClient(dir);
      const repo = {
        provider: 'azure-devops' as const,
        owner: ORG,
        project: PROJECT,
        name: REPO,
      };
      const rawUrl = buildCloneUrl({
        vcsProvider: 'azure-devops',
        owner: ORG,
        name: REPO,
        project: PROJECT,
        baseUrl: BASE_URL,
      });
      const authedUrl = withVcsToken(rawUrl, 'azure-devops', pat!);

      const { path } = await git.clone(repo, authedUrl, { depth: 1 });
      await git.fetchPullHead(repo, PR_NUMBER, authedUrl);
      const raw = simpleGit(path);
      const realSha = (await raw.revparse([`pr-${PR_NUMBER}`])).trim();

      // Force the local ref onto a fabricated orphan commit — by
      // construction not an ancestor of `realSha` (or of anything), so any
      // update back to `realSha` is necessarily non-fast-forward.
      const emptyTree = (await raw.raw(['hash-object', '-t', 'tree', '/dev/null'])).trim();
      const orphanSha = (
        await raw.raw(['commit-tree', emptyTree, '-m', 'deliberately unrelated history'])
      ).trim();
      await raw.raw(['update-ref', `refs/heads/pr-${PR_NUMBER}`, orphanSha]);
      expect((await raw.revparse([`pr-${PR_NUMBER}`])).trim()).toBe(orphanSha);

      // Re-running fetchPullHead must NOT throw, and must force the local
      // ref back onto the real remote merge commit (R26's "guaranteed
      // reachable" contract, now proven for the re-fetch case too).
      await git.fetchPullHead(repo, PR_NUMBER, authedUrl);
      const shaAfterRefetch = (await raw.revparse([`pr-${PR_NUMBER}`])).trim();
      expect(shaAfterRefetch).toBe(realSha);
    },
    120_000,
  );
});

async function listFilesRecursively(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await listFilesRecursively(full)));
    else out.push(full);
  }
  return out;
}
