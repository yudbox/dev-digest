import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { SimpleGitClient } from './simple-git.js';

/**
 * TASK-005 (SPEC-2026-08-25-azure-devops-integration) — `clonePathFor`
 * coverage. Pure function (no I/O), so this is a plain hermetic unit test.
 *
 * P2 (plan): `github:acme/api` and `azure-devops:acme/api` previously
 * collided on the SAME on-disk directory (`<cloneDir>/acme/api`) since the
 * path had no provider segment. AC-005-4 requires them to now diverge;
 * AC-005-5 requires GitHub's own path to stay byte-for-byte identical to
 * before this task, so on-disk clones from before this change are never
 * "lost" by the app looking in a new location.
 */
describe('SimpleGitClient.clonePathFor', () => {
  const cloneDir = '/clones';
  const git = new SimpleGitClient(cloneDir);

  it('AC-005-5 — GitHub path is unchanged (no provider given, matches pre-TASK-005 behavior)', () => {
    expect(git.clonePathFor({ owner: 'acme', name: 'api' })).toBe(join(cloneDir, 'acme', 'api'));
  });

  it('GitHub path is unchanged even when provider is given explicitly', () => {
    expect(git.clonePathFor({ provider: 'github', owner: 'acme', name: 'api' })).toBe(
      join(cloneDir, 'acme', 'api'),
    );
  });

  it('AC-005-4 — Azure DevOps gets a provider-segmented path, distinct from the equivalent GitHub path', () => {
    const githubPath = git.clonePathFor({ provider: 'github', owner: 'acme', name: 'api' });
    const adoPath = git.clonePathFor({
      provider: 'azure-devops',
      owner: 'acme',
      project: 'proj',
      name: 'api',
    });
    expect(adoPath).not.toBe(githubPath);
    expect(adoPath).toBe(join(cloneDir, 'azure-devops', 'acme', 'proj', 'api'));
  });

  it('Azure DevOps without a project segment still gets a provider-segmented, GitHub-distinct path', () => {
    const githubPath = git.clonePathFor({ provider: 'github', owner: 'acme', name: 'api' });
    const adoPath = git.clonePathFor({ provider: 'azure-devops', owner: 'acme', name: 'api' });
    expect(adoPath).not.toBe(githubPath);
    expect(adoPath).toBe(join(cloneDir, 'azure-devops', 'acme', 'api'));
  });

  it('two different Azure DevOps projects under the same owner/name never collide', () => {
    const a = git.clonePathFor({
      provider: 'azure-devops',
      owner: 'acme',
      project: 'proj-a',
      name: 'api',
    });
    const b = git.clonePathFor({
      provider: 'azure-devops',
      owner: 'acme',
      project: 'proj-b',
      name: 'api',
    });
    expect(a).not.toBe(b);
  });
});

/**
 * AC-005-3/AC-009-2 — a failed clone/fetch must never leak the embedded PAT
 * into the thrown error's message/stack (which `JobRunner` persists verbatim
 * to the job's `error` column). Hermetic: connects to an unroutable
 * loopback port rather than any real host — no network or real PAT needed. A
 * clearly-fake, obviously-not-a-real-credential placeholder is used.
 */
describe('SimpleGitClient — PAT redaction on clone failure', () => {
  const FAKE_TOKEN = 'not-a-real-pat-0123456789';

  it('does not leak the embedded PAT in the rejection when the clone fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devdigest-git-fail-'));
    try {
      const git = new SimpleGitClient(dir);
      const repo = {
        provider: 'azure-devops' as const,
        owner: 'acme',
        project: 'proj',
        name: 'api',
      };
      // Port 1 is (almost) never listening — connection is refused near-instantly.
      const url = `https://:${FAKE_TOKEN}@127.0.0.1:1/doesnotexist/repo`;

      await expect(git.clone(repo, url)).rejects.toSatisfy((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? (err.stack ?? '') : '';
        return !message.includes(FAKE_TOKEN) && !stack.includes(FAKE_TOKEN);
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
