import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ReviewSummariesService } from './service';
import { getContext } from '../_shared/context';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export const reviewSummariesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/review-summaries', async (req, reply) => {
    const { workspaceId } = getContext(app.container, req);
    const query = listQuerySchema.parse(req.query);
    const service = new ReviewSummariesService(app.container);
    const summaries = await service.summarizeRecent(workspaceId, query.limit);
    reply.send({ summaries });
  });

  app.get('/review-summaries/:prId', async (req, reply) => {
    const { workspaceId } = getContext(app.container, req);
    const { prId } = req.params as { prId: string };
    const service = new ReviewSummariesService(app.container);
    const summary = await service.summaryForOne(workspaceId, prId);
    if (!summary) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }
    reply.send(summary);
  });
};
