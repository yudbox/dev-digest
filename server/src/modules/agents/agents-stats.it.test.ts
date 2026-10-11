import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AuthProvider } from "@devdigest/shared";
import { startMemoryPg, type MemoryPgFixture } from "../../../test/helpers/memory-pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { addAgent, addReviewWithFindings, addRun, createWorld, type World } from "../performance/it-fixtures.js";

/**
 * Agents list stats (`GET /agents`, `GET /agents/:id`). The numbers come from the
 * shared performance aggregation, so they follow the same rules as the dashboard:
 * only finished runs count, accept rate is finding-level over resolved findings,
 * averages are over known cost / successful runs, and "no decisions" is omitted
 * rather than reported as 0%.
 *
 * Runs on an in-memory Postgres (PGlite) — no Docker, no real database.
 */
const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

describe("agent list stats (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let world: World;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startMemoryPg();
    world = await createWorld(pg.handle.db);
    const auth: AuthProvider = {
      currentUser: async () => ({ id: "00000000-0000-4000-8000-0000000000aa", email: "t@t", name: "t" }),
      currentWorkspace: async () => ({ id: world.ws, name: "stats" }),
    };
    app = await buildApp({ config: config(), db: pg.handle.db, overrides: { auth } });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it("GET /agents attaches runs_count, finding-level accept rate, avg cost and avg duration", async () => {
    const db = pg.handle.db;
    const a = await addAgent(db, world, "Stats Agent A");
    const b = await addAgent(db, world, "Stats Agent B (no runs)");

    // costs 2.0 and null → average over KNOWN cost is 2.0, not 1.0
    const r1 = await addRun(db, world, { agentId: a, ranAt: hoursAgo(5), costUsd: 2.0, durationMs: 1000 });
    const r2 = await addRun(db, world, { agentId: a, ranAt: hoursAgo(4), costUsd: null, durationMs: 3000 });
    // not finished → excluded from every number
    await addRun(db, world, { agentId: a, ranAt: hoursAgo(3), status: "running", costUsd: 50 });
    await addRun(db, world, { agentId: a, ranAt: hoursAgo(3), status: "cancelled", costUsd: 50 });
    // failed → counted as a run (it consumed resources) but not in the duration average
    await addRun(db, world, { agentId: a, ranAt: hoursAgo(2), status: "failed", costUsd: null, durationMs: 9 });

    // 3 resolved (2 accepted, 1 dismissed) + 1 unresolved → 67%
    await addReviewWithFindings(db, world, { agentId: a, runId: r1.id }, [{ accepted: true }, { accepted: true }]);
    await addReviewWithFindings(db, world, { agentId: a, runId: r2.id }, [{ dismissed: true }, {}]);

    const list = (await app.inject({ method: "GET", url: "/agents" })).json();
    const dtoA = list.find((x: { id: string }) => x.id === a);
    const dtoB = list.find((x: { id: string }) => x.id === b);

    expect(dtoA.runs_count).toBe(3);
    expect(dtoA.accept_rate_pct).toBe(67);
    expect(dtoA.avg_cost_usd).toBe(2.0);
    expect(dtoA.avg_duration_ms).toBe(2000);

    // An agent with no runs / no decisions has no invented numbers.
    expect(dtoB.runs_count).toBe(0);
    expect(dtoB).not.toHaveProperty("accept_rate_pct");
    expect(dtoB.avg_cost_usd).toBeNull();
    expect(dtoB.avg_duration_ms).toBeNull();

    // The single-agent GET agrees with the list view.
    const single = (await app.inject({ method: "GET", url: `/agents/${a}` })).json();
    expect(single.runs_count).toBe(dtoA.runs_count);
    expect(single.accept_rate_pct).toBe(dtoA.accept_rate_pct);
    expect(single.avg_cost_usd).toBe(dtoA.avg_cost_usd);
    expect(single.avg_duration_ms).toBe(dtoA.avg_duration_ms);
  });

  it("the list numbers equal the Agent Stats KPIs over an all-time-wide period", async () => {
    const db = pg.handle.db;
    const a = await addAgent(db, world, "Parity Agent");
    const r = await addRun(db, world, { agentId: a, ranAt: hoursAgo(6), costUsd: 0.5, durationMs: 2500 });
    await addReviewWithFindings(db, world, { agentId: a, runId: r.id }, [{ accepted: true }, { dismissed: true }]);

    const list = (await app.inject({ method: "GET", url: "/agents" })).json();
    const dto = list.find((x: { id: string }) => x.id === a);
    const stats = (await app.inject({ method: "GET", url: `/agents/${a}/stats?range=30d&tz=UTC` })).json();

    expect(dto.runs_count).toBe(stats.kpis.runs);
    expect(dto.avg_cost_usd).toBeCloseTo(stats.kpis.avgCostUsd, 9);
    expect(dto.avg_duration_ms).toBe(stats.kpis.avgDurationMs);
    expect(dto.accept_rate_pct).toBe(Math.round((stats.kpis.accept.accepted / stats.kpis.accept.resolved) * 100));
  });
});
