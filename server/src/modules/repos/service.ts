import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import { type Repo } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from './repository.js';
import { parseRepoUrl, withGitHubToken, toRepoDto } from './helpers.js';
import {
  CLONE_JOB_KIND,
  CLONE_DEPTH,
  GITHUB_TOKEN_SECRET,
} from './constants.js';
import {
  INDEX_JOB_KIND,
  REFRESH_JOB_KIND,
} from '../repo-intel/constants.js';

/**
 * F1 — repos service. Business logic for the Repositories feature:
 *   - add / list / refresh / remove
 *   - the asynchronous `clone` job (real `git clone` via the GitClient adapter)
 *
 * No HTTP and no raw SQL live here — persistence goes through RepoRepository,
 * pure transforms through helpers.ts, literals through constants.ts.
 */

/** Payload enqueued for (and consumed by) the `clone` job. */
export interface CloneJobPayload {
  repoId: string;
  owner: string;
  name: string;
  url: string;
  /** Existing on-disk clone path. When present and valid, skip re-clone and just fetch. */
  clonePath?: string;
}

export class RepoService {
  private repo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }

  /**
   * Register the `clone` job handler once. Authenticates the clone with the
   * stored GitHub PAT (so private repos work), clones via the GitClient adapter,
   * then persists the resulting path + last_polled_at.
   */
  registerCloneJobHandler(): void {
    this.container.jobs.register(CLONE_JOB_KIND, async (payload) => {
      await this.runCloneJob(payload as CloneJobPayload);
    });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name, url, clonePath } = payload;

    // If a clone already exists at the stored path (e.g. imported from Azure DevOps),
    // just fetch from the already-configured remote instead of re-cloning from GitHub.
    if (clonePath) {
      const hasGit = await access(join(clonePath, '.git'), constants.F_OK)
        .then(() => true)
        .catch(() => false);
      if (hasGit) {
        const { simpleGit } = await import('simple-git');
        try {
          const sg = simpleGit(clonePath, { timeout: { block: 15000 } })
            .env({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
          // Embed credentials into the remote URL so git doesn't prompt.
          const remoteUrl: string = (await sg.remote(['get-url', 'origin']) as string).trim();
          const azureToken = await this.container.secrets.get('AZURE_DEVOPS_TOKEN');
          let fetchUrl = remoteUrl;
          if (azureToken && remoteUrl.includes('dev.azure.com')) {
            const u = new URL(remoteUrl);
            u.username = 'pat';
            u.password = azureToken;
            fetchUrl = u.toString();
          }
          await sg.fetch([fetchUrl]);
          console.info(`[clone-job] Fetched existing clone ${owner}/${name}`);
        } catch (err) {
          console.warn(`[clone-job] Fetch failed for ${owner}/${name} — using existing clone as-is`);
        }
        return;
      }
    }

    const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
    const cloneUrl = token ? withGitHubToken(url, token) : url;
    let path: string;
    try {
      ({ path } = await this.container.git.clone({ owner, name }, cloneUrl, {
        depth: CLONE_DEPTH,
      }));
    } catch (err) {
      console.warn(`[clone-job] Clone failed for ${owner}/${name} — repo kept with existing clone_path`, err);
      return;
    }
    await this.repo.updateClonePath(repoId, path);

    // T2.2 — kick off the indexer in the background. ENQUEUE (not call) so the
    // clone job closes immediately and the (heavier) index runs as its own
    // job under JobRunner's timeout/retry. If the handler isn't registered
    // (e.g. repo-intel disabled at module wiring), enqueue() throws — log and
    // continue so the clone result is preserved either way.
    const workspaceId = await this.repo.workspaceIdFor(repoId);
    if (workspaceId) {
      try {
        await this.container.jobs.enqueue(workspaceId, INDEX_JOB_KIND, {
          repoId,
          owner,
          name,
        });
      } catch {
        // No handler registered or transient enqueue failure — clone has
        // already succeeded, so we don't fail the job for an index-followup
        // miss. The user can hit POST /repos/:id/reindex to retry.
      }
    }
  }

  /**
   * Add a repo: parse the URL, dedupe within the workspace, persist, and enqueue
   * the real clone (non-blocking). `created` is false when the repo already
   * existed (the caller returns 200 instead of 201).
   */
  async add(
    workspaceId: string,
    userId: string,
    url: string,
  ): Promise<{ repo: Repo; created: boolean }> {
    const { owner, name } = parseRepoUrl(url);
    const fullName = `${owner}/${name}`;

    const existing = await this.repo.findByFullName(workspaceId, fullName);
    if (existing) return { repo: toRepoDto(existing), created: false };

    const row = await this.repo.insert({ workspaceId, owner, name, fullName, createdBy: userId });
    await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: row.id,
      owner,
      name,
      url,
    } satisfies CloneJobPayload);

    return { repo: toRepoDto(row), created: true };
  }

  async list(workspaceId: string): Promise<Repo[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toRepoDto);
  }

  /** Re-fetch the clone for an existing repo (enqueues a fresh `clone` job). */
  async refresh(workspaceId: string, id: string): Promise<{ status: 'refreshing' }> {
    const repo = await this.repo.getById(workspaceId, id);
    if (!repo) throw new NotFoundError('Repo not found');
    await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: `https://github.com/${repo.fullName}.git`,
      clonePath: repo.clonePath ?? undefined,
    } satisfies CloneJobPayload);
    // T2.2 — also enqueue an incremental refresh. The two queue positions are
    // independent (p-queue doesn't FIFO across kinds), but `runIncremental` is
    // a no-op when `currentHead === lastIndexedSha`, so ordering is safe: if
    // refresh fires before the new clone settles, it cheaply exits; if after,
    // it picks up the new HEAD.
    try {
      await this.container.jobs.enqueue(workspaceId, REFRESH_JOB_KIND, {
        repoId: repo.id,
        owner: repo.owner,
        name: repo.name,
      });
    } catch {
      // No handler / transient enqueue failure — refresh button is best-effort.
    }
    return { status: 'refreshing' };
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.remove(workspaceId, id);
    if (!ok) throw new NotFoundError('Repo not found');
  }
}
