import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { RunRequest, FindingAction } from "@devdigest/shared";
import type { RunEvent } from "@devdigest/shared";
import { getContext } from "../_shared/context.js";
import { IdParams } from "../_shared/schemas.js";
import { NotFoundError } from "../../platform/errors.js";
import { ReviewService } from "./service.js";
import { EvalsService } from "../evals/service.js";

/**
 * reviews module.
 *   POST   /pulls/:id/review              {agentId} | {all:true}   → run review(s)
 *   POST   /pulls/:id/multi-agent-run     {agentIds:[]}            → multi-agent batch
 *   GET    /multi-agent-runs              ?limit&cursor&status&q   → list runs (keyset)
 *   GET    /multi-agent-runs/:id                                   → full detail
 *   GET    /runs/:id/events                                        → SSE stream
 *   GET    /runs/:id/trace                                         → RunTrace doc
 *   GET    /pulls/:id/reviews                                      → reviews + findings
 *   POST   /findings/:id/(accept|dismiss|undo|learn|reply)         → finding actions
 *   POST   /findings/:id/eval-case                                 → eval-case prefill
 */
const FINDING_ACTIONS = [
  "accept",
  "dismiss",
  "undo",
  "learn",
  "reply",
] as const;

const MultiAgentRunRequest = z.object({
  agentIds: z.array(z.string().uuid()).min(1),
});

const MultiAgentRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  status: z.enum(["running", "failed", "done"]).optional(),
  q: z.string().optional(),
});

export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);
  const evalsService = new EvalsService(app.container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    "/pulls/:id/review",
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const body = RunRequest.parse(req.body ?? {});
      const targets = await service.resolveTargets(workspaceId, {
        ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
        ...(body.all !== undefined ? { all: body.all } : {}),
      });
      const { runs, reviews } = await service.runReview(
        workspaceId,
        req.params.id,
        targets,
        req.log,
      );
      return { pr_id: req.params.id, runs, reviews };
    },
  );

  // ---- Multi-agent review run (N≥1 agents, always creates multi_agent_runs row) -
  app.post(
    "/pulls/:id/multi-agent-run",
    {
      schema: { params: IdParams, body: MultiAgentRunRequest },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const { multiAgentRunId, runs } = await service.runMultiAgentReview(
        workspaceId,
        req.params.id,
        req.body.agentIds,
        req.log,
      );
      return { multi_agent_run_id: multiAgentRunId, pr_id: req.params.id, runs };
    },
  );

  // ---- Multi-agent runs list (workspace-scoped, keyset pagination) ---------
  app.get(
    "/multi-agent-runs",
    { schema: { querystring: MultiAgentRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listMultiAgentRuns({
        workspaceId,
        limit: req.query.limit,
        cursor: req.query.cursor,
        status: req.query.status,
        q: req.query.q,
      });
    },
  );

  // ---- Multi-agent run detail (full with columns + conflicts) --------------
  app.get(
    "/multi-agent-runs/:id",
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const run = await service.getMultiAgentRun(workspaceId, req.params.id);
      if (!run) throw new NotFoundError("Multi-agent run not found");
      return run;
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    "/runs/:id/events",
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
      await getContext(container, req);
      const runId = req.params.id;

      reply.sse(
        (async function* () {
          // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
          const queue: RunEvent[] = [];
          let resolve: (() => void) | null = null;
          let done = false;

          const unsubscribe = container.runBus.subscribe(runId, (e) => {
            queue.push(e);
            resolve?.();
          });
          const offDone = container.runBus.onDone(runId, () => {
            done = true;
            resolve?.();
          });

          try {
            while (true) {
              if (queue.length === 0) {
                if (done) break;
                await new Promise<void>((r) => (resolve = r));
                resolve = null;
                continue;
              }
              const e = queue.shift()!;
              yield {
                id: String(e.seq),
                event: e.kind,
                data: JSON.stringify(e),
              };
            }
          } finally {
            unsubscribe();
            offDone();
          }
        })(),
      );
    },
  );

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get(
    "/pulls/:id/runs/active",
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.activeRuns(workspaceId, req.params.id);
    },
  );

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get("/pulls/:id/runs", { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete("/runs/:id", { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post(
    "/runs/:id/cancel",
    { schema: { params: IdParams } },
    async (req) => {
      await getContext(container, req);
      await service.cancelRun(req.params.id);
      return { ok: true };
    },
  );

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get("/runs/:id/trace", { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError("Run trace not found");
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get(
    "/pulls/:id/reviews",
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.reviewsForPull(workspaceId, req.params.id);
    },
  );

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete("/reviews/:id", { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError("Review not found");
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss / undo / learn / reply) ----------
  for (const action of FINDING_ACTIONS) {
    app.post(
      `/findings/:id/${action}`,
      { schema: { params: IdParams, body: FindingAction.partial().nullable().optional() } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        const body = req.body as { note?: string } | undefined;
        return service.actOnFinding(workspaceId, req.params.id, action, body);
      },
    );
  }

  // ---- Turn a resolved finding into an eval-case prefill (no DB insert) ----
  app.post(
    "/findings/:id/eval-case",
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return evalsService.prefillFromFinding(workspaceId, req.params.id);
    },
  );

  // ---- Intent: read + recalculate -----------------------------------------

  // GET /pulls/:id/intent — return stored intent (404 if not yet derived)
  app.get(
    "/pulls/:id/intent",
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const intent = await service.getIntent(workspaceId, req.params.id);
      if (!intent) {
        return reply.status(404).send({
          error: {
            code: "intent_not_found",
            message: "Intent not yet derived for this PR",
          },
        });
      }
      return intent;
    },
  );

  // POST /pulls/:id/intent/recalculate — force re-derive (ignores headSha cache)
  app.post(
    "/pulls/:id/intent/recalculate",
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const intentText = await service.recalculateIntent(
        workspaceId,
        req.params.id,
        req.log,
      );
      if (!intentText) {
        return reply.status(500).send({
          error: { code: "intent_failed", message: "Intent derivation failed" },
        });
      }
      return service.getIntent(workspaceId, req.params.id);
    },
  );
}
