import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RepoInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RepoService } from './service.js';

/**
 * F1 — repos module. Transport layer only: parses requests, maps status
 * codes, and delegates all business logic to RepoService.
 *   POST   /repos              → add repo (parse URL, persist, enqueue real clone)
 *   GET    /repos              → list repos (workspace-scoped)
 *   POST   /repos/:id/refresh      → re-fetch clone + bump last_polled_at
 *   GET    /repos/:id/sync-status  → { commits_behind, last_polled_at } (fetches, but never moves the local branch)
 *   DELETE /repos/:id              → remove repo
 *
 * The clone runs as a JobRunner job (kind 'clone') — real `git clone` via the
 * GitClient adapter into <cloneDir>/<owner>/<repo>.
 */

/**
 * `vcs_provider === 'azure-devops'` requires a non-empty `base_url` — this is
 * a cross-field rule specific to this one endpoint, so it's layered onto the
 * shared `RepoInput` contract here (presentation layer) rather than baked
 * into the contract itself. `path: ['base_url']` points a client-side form
 * at the exact field to highlight.
 */
const AddRepoBody = RepoInput.superRefine((data, ctx) => {
  if (data.vcs_provider === 'azure-devops' && !data.base_url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['base_url'],
      message: "base_url is required when vcs_provider is 'azure-devops'",
    });
  }
});

export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  // Register the clone job handler once.
  service.registerCloneJobHandler();

  app.post('/repos', { schema: { body: AddRepoBody } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url, {
      vcsProvider: req.body.vcs_provider,
      baseUrl: req.body.base_url,
    });
    reply.status(created ? 201 : 200);
    return repo;
  });

  app.get('/repos', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/repos/:id/refresh', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.refresh(workspaceId, req.params.id);
  });

  // Read-only staleness check (commits behind + last synced) for the PR-list
  // header banner — the client calls this at most once/day per repo.
  app.get('/repos/:id/sync-status', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.syncStatus(workspaceId, req.params.id);
  });

  app.delete('/repos/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    return { deleted: req.params.id };
  });
}
