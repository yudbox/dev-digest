import { FastifyPluginAsync } from 'fastify';
import { getContext } from '../_shared/context';
import { WebhooksService } from './service';

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/webhooks/deliveries', async (req, reply) => {
    const { workspaceId } = getContext(app.container, req);
    const service = new WebhooksService(app.container);
    const items = await service.listRecent(workspaceId);
    reply.send({ items });
  });
};
