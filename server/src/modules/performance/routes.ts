import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  AgentPerformanceResponse,
  AgentRunsResponse,
  AgentStatsResponse,
  RunFindingsResponse,
  StatsQuery,
} from "@devdigest/shared";
import { getContext } from "../_shared/context.js";
import { IdParams } from "../_shared/schemas.js";
import { PerformanceService } from "./service.js";
import { parsePageQuery, parseStatsQuery } from "./query.js";

/**
 * Performance module — read-only stats endpoints (no LLM, embedder, review or
 * CI import on any of them):
 *   GET /agent-performance        → dashboard KPIs, agent table, cost breakdown
 *   GET /agents/:id/stats         → one agent's Stats tab
 *   GET /agents/:id/runs          → run history, cursor-paged
 *   GET /runs/:id/findings        → findings of one run (trace drawer)
 *
 * Period query: `range=1d|30d` OR `from`+`to` (≤ 30 days), plus `tz` (IANA).
 * Anything malformed is a 400 (see parseStatsQuery), not a 422.
 */
export default async function performanceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PerformanceService(app.container);

  app.get(
    "/agent-performance",
    { schema: { querystring: StatsQuery, response: { 200: AgentPerformanceResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.dashboard(workspaceId, parseStatsQuery(req.query));
    },
  );

  app.get(
    "/agents/:id/stats",
    {
      schema: {
        params: IdParams,
        querystring: StatsQuery,
        response: { 200: AgentStatsResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentStats(workspaceId, req.params.id, parseStatsQuery(req.query));
    },
  );

  app.get(
    "/agents/:id/runs",
    {
      schema: {
        params: IdParams,
        querystring: StatsQuery,
        response: { 200: AgentRunsResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentRuns(
        workspaceId,
        req.params.id,
        parseStatsQuery(req.query),
        parsePageQuery(req.query),
      );
    },
  );

  app.get(
    "/runs/:id/findings",
    { schema: { params: IdParams, response: { 200: RunFindingsResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runFindings(workspaceId, req.params.id);
    },
  );
}
