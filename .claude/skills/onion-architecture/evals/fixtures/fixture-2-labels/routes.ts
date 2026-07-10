import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LabelsService } from './service';

const createBodySchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export const labelsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/repos/:repoId/labels', async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const service = new LabelsService(app.container);
    const items = await service.listByRepo(repoId);
    reply.send({ items });
  });

  app.post('/repos/:repoId/labels', async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const body = createBodySchema.parse(req.body);
    const service = new LabelsService(app.container);
    const label = await service.create(repoId, body.name, body.color);
    reply.status(201).send(label);
  });
};
