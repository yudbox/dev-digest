/**
 * Memory module routes.
 *
 *   POST   /memory              → create explicit memory item
 *   GET    /memory              → list (with filters)
 *   PATCH  /memory/:id          → partial update
 *   DELETE /memory/:id          → delete
 *   POST   /memory/refresh      → re-read local DB + trigger learning
 *
 * TASK-005.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  MemoryCreateInput,
  MemoryListQuery,
  MemoryUpdateInput,
} from "@devdigest/shared";
import { getContext } from "../_shared/context.js";
import { IdParams } from "../_shared/schemas.js";
import { NotFoundError } from "../../platform/errors.js";
import { MemoryService } from "./service.js";

export default async function memoryRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MemoryService(container);

  // POST /memory/refresh must be registered BEFORE /memory/:id to avoid conflicts
  app.post("/memory/refresh", {}, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.refresh(workspaceId);
  });

  app.post(
    "/memory",
    { schema: { body: MemoryCreateInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const item = await service.create(workspaceId, req.body);
      reply.status(201);
      return item;
    },
  );

  app.get(
    "/memory",
    { schema: { querystring: MemoryListQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const items = await service.list(workspaceId, req.query);
      return { items };
    },
  );

  app.patch(
    "/memory/:id",
    { schema: { params: IdParams, body: MemoryUpdateInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const item = await service.update(workspaceId, req.params.id, req.body);
      if (!item) throw new NotFoundError("Memory item not found");
      return item;
    },
  );

  app.delete(
    "/memory/:id",
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const ok = await service.delete(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError("Memory item not found");
      reply.status(204);
      return null;
    },
  );
}
