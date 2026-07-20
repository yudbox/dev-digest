/**
 * CI module routes.
 *   POST   /agents/:id/export-ci               → CiService.exportCi
 *   GET    /agents/:id/ci-installations        → CiService.getInstallations
 *   GET    /ci-runs                            → CiService.getCiRuns
 *   POST   /ci-runs/refresh                    → CiService.ingestAll
 *
 * Pattern: same ZodTypeProvider + getContext convention as reviews/routes.ts.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CiExportInput, CiRunsQuery } from "@devdigest/shared";
import { getContext } from "../_shared/context.js";
import { IdParams } from "../_shared/schemas.js";
import { CiService } from "./service.js";
import { buildZip } from "./zip.js";

/**
 * CI routes plugin. Registered via modules/index.ts.
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new CiService(container);

  // ---- Export CI -----------------------------------------------------------
  // NOTE: /agents/:id/export-ci must be registered BEFORE /agents/:id to avoid
  // path conflicts when Fastify matches literal segments vs uuid params.
  app.post(
    "/agents/:id/export-ci",
    { schema: { params: IdParams, body: CiExportInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.exportCi(
        req.params.id,
        req.body,
        workspaceId,
      );

      if (req.body.action === "files") {
        // Return a ZIP archive instead of JSON
        const zipBuf = buildZip(
          result.files.map((f) => ({ path: f.path, contents: f.contents })),
        );
        return reply
          .status(200)
          .header("Content-Type", "application/zip")
          .header(
            "Content-Disposition",
            'attachment; filename="devdigest-ci.zip"',
          )
          .send(zipBuf);
      }

      if (req.body.action === "preview") {
        // Return files as JSON for the wizard Preview step (no PR, no ZIP)
        return reply
          .status(200)
          .send({ files: result.files, installation: null, pr_url: null });
      }

      // open_pr path — return JSON (matches CiExport contract)
      return reply.status(201).send(result);
    },
  );

  // ---- CI installations for an agent ---------------------------------------
  app.get(
    "/agents/:id/ci-installations",
    { schema: { params: IdParams } },
    async (req) => {
      await getContext(container, req);
      return service.getInstallations(req.params.id);
    },
  );

  // ---- Update CI config (re-export to all repos for this agent) -----------
  app.post(
    "/agents/:id/ci-config",
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await service.updateCiConfig(req.params.id, workspaceId);
      return { ok: true };
    },
  );

  // ---- CI runs list (with optional server-side filters) -------------------
  app.get("/ci-runs", { schema: { querystring: CiRunsQuery } }, async (req) => {
    await getContext(container, req);
    const runs = await service.getCiRuns(req.query);
    return { runs };
  });

  // ---- Trigger ingest refresh ---------------------------------------------
  app.post(
    "/ci-runs/refresh",
    { schema: { body: z.object({ repo: z.string().optional() }).optional() } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.ingestAll(workspaceId);
    },
  );
}
