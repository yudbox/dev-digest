import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalOwnerKind } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalsService } from './service.js';

/**
 * A6 — evals module.
 *   POST   /eval-cases                → create a case
 *   GET    /eval-cases                → list (optionally ?owner_kind&owner_id)
 *   GET    /eval-cases/:id            → one case
 *   PATCH  /eval-cases/:id            → partial update
 *   DELETE /eval-cases/:id            → delete (cascades eval_runs)
 *   POST   /eval-cases/:id/run        → run one case (agent: 1 LLM call; skill: 2)
 *   POST   /agents/:id/eval-runs      → "Run all evals" for one agent (batch)
 *   POST   /skills/:id/eval-runs      → run all of a skill's cases (batch, no summary)
 *   GET    /agents/:id/eval-dashboard → EvalDashboard for one agent
 *   GET    /skills/:id/eval-dashboard → EvalDashboard for one skill
 *   GET    /eval-dashboard            → workspace-wide EvalDashboardOverview
 *   POST   /eval-runs/all             → "Run all evals" for every eligible agent
 *
 * `POST /findings/:id/eval-case` lives in `reviews/routes.ts` (cross-module);
 * `GET /agents/:id/versions` lives in `agents/routes.ts`.
 */

const ListCasesQuery = z.object({
  owner_kind: EvalOwnerKind.optional(),
  owner_id: z.string().optional(),
});

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalsService(container);

  // ---- eval_cases CRUD ------------------------------------------------------

  app.post('/eval-cases', { schema: { body: EvalCaseInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.createCase(workspaceId, req.body);
    reply.status(201);
    return evalCase;
  });

  app.get('/eval-cases', { schema: { querystring: ListCasesQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const { owner_kind, owner_id } = req.query;
    return service.listCases(workspaceId, owner_kind, owner_id);
  });

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.getCase(workspaceId, req.params.id);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    return evalCase;
  });

  app.patch(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseInput.partial() } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    reply.status(204);
    return null;
  });

  // ---- running ---------------------------------------------------------------

  app.post(
    '/eval-cases/:id/run',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runCase(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAgentEvals(workspaceId, req.params.id);
    },
  );

  app.post(
    '/skills/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runSkillEvals(workspaceId, req.params.id);
    },
  );

  app.post(
    '/eval-runs/all',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAllForWorkspace(workspaceId);
    },
  );

  // ---- dashboards -------------------------------------------------------------

  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.dashboardForOwner(workspaceId, 'agent', req.params.id);
    },
  );

  app.get(
    '/skills/:id/eval-dashboard',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.dashboardForOwner(workspaceId, 'skill', req.params.id);
    },
  );

  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.dashboardOverview(workspaceId);
  });
}
