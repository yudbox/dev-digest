import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { NotificationsRepository } from './repository';
import { getContext } from '../_shared/context';

const listQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notifications', async (req, reply) => {
    const { workspaceId, user } = getContext(app.container, req);
    const query = listQuerySchema.parse(req.query);

    const repo = new NotificationsRepository(app.container.db);
    let items = await repo.listByWorkspace(workspaceId);

    if (user.role !== 'admin') {
      items = items.filter((item) => item.visibility !== 'internal');
    }

    if (query.unreadOnly) {
      items = items.filter((item) => !item.readAt);
    }

    reply.send({ items });
  });

  app.post('/notifications/:id/read', async (req, reply) => {
    const { workspaceId } = getContext(app.container, req);
    const { id } = req.params as { id: string };
    const repo = new NotificationsRepository(app.container.db);
    await repo.markRead(workspaceId, id);
    reply.status(204).send();
  });
};
