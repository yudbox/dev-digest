import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import { startMemoryPg, type MemoryPgFixture } from "../../test/helpers/memory-pg.js";
import * as t from "./schema.js";
import { seed } from "./seed.js";
import { seedPerformanceDemo } from "./seed-performance.js";
import { PerformanceRepository } from "../modules/performance/repository.js";
import { PerformanceService } from "../modules/performance/service.js";
import { resolveWindow } from "../modules/performance/window.js";

/**
 * The demo seed must be idempotent, contain no `running` runs, give every
 * memory entry an embedding, and produce data on which every dashboard rule has
 * something to show. In-memory Postgres (PGlite): no Docker, no real database.
 */
describe("performance demo seed (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let workspaceId: string;
  const NOW = new Date("2026-10-11T09:22:00Z");
  const db = () => pg.handle.db;

  const counts = async () => {
    const one = async (table: Parameters<ReturnType<typeof db>["select"]>[0] extends never ? never : any) =>
      (await db().select({ n: count() }).from(table))[0]!.n;
    return {
      runs: await one(t.agentRuns),
      reviews: await one(t.reviews),
      findings: await one(t.findings),
      runSkills: await one(t.agentRunSkills),
      runMemory: await one(t.agentRunMemory),
      memory: await one(t.memory),
      ciRuns: await one(t.ciRuns),
      ciFindings: await one(t.ciRunFindings),
      agents: await one(t.agents),
      prs: await one(t.pullRequests),
    };
  };

  beforeAll(async () => {
    pg = await startMemoryPg();
    ({ workspaceId } = await seed(db()));
    await seedPerformanceDemo(db(), { workspaceId, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await pg?.stop();
  });

  it("is idempotent: seeding twice leaves identical row counts", async () => {
    const before = await counts();
    await seed(db());
    await seedPerformanceDemo(db(), { workspaceId, now: NOW });
    expect(await counts()).toEqual(before);
    expect(before.runs).toBeGreaterThan(200);
  }, 120_000);

  it("has no running runs, but has cancelled, failed, deleted-agent, CI and legacy runs", async () => {
    const rows = await db().select().from(t.agentRuns);
    expect(rows.filter((r) => r.status === "running")).toHaveLength(0);
    expect(rows.some((r) => r.status === "cancelled")).toBe(true);
    expect(rows.some((r) => r.status === "failed")).toBe(true);
    expect(rows.some((r) => r.agentId === null)).toBe(true);
    expect(rows.some((r) => r.source === "ci" && r.ciRunId !== null)).toBe(true);
    expect(rows.some((r) => r.source === "ci" && r.ciRunId === null)).toBe(true);
    expect(rows.some((r) => r.costSource === "api")).toBe(true);
    expect(rows.some((r) => r.costSource === "estimate")).toBe(true);
    expect(rows.some((r) => r.costSource === null && r.costUsd !== null)).toBe(true); // legacy: cost but no source
    expect(rows.some((r) => r.memoryMode === "top_k")).toBe(true);
    expect(rows.some((r) => r.memoryMode === "fallback")).toBe(true);
    expect(rows.some((r) => r.memoryMode === null)).toBe(true);
  });

  it("spans more than 60 days of history (so the 30-day cost delta exists)", async () => {
    const [row] = await db().select({ first: sql<Date>`min(${t.agentRuns.ranAt})` }).from(t.agentRuns);
    const days = (NOW.getTime() - new Date(row!.first).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(60);
  });

  it("gives every memory entry an embedding", async () => {
    const rows = (await db().execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM memory WHERE embedding IS NULL`)) as { n: number }[];
    expect(rows[0]!.n).toBe(0);
    expect((await counts()).memory).toBeGreaterThanOrEqual(6);
  });

  it("includes an agent without runs and a disabled agent", async () => {
    const svc = new PerformanceService({ performanceRepo: new PerformanceRepository(db()) } as never);
    const out = await svc.dashboard(workspaceId, resolveWindow({ kind: "30d" }, "UTC", NOW));
    const mentor = out.agents.find((a) => a.name === "Custom Mentor");
    expect(mentor).toMatchObject({ runs: 0, avgCostUsd: null, lastRunAt: null });
    expect(out.agents.find((a) => a.name === "Docs Reviewer")?.enabled).toBe(false);
    expect(out.agents.some((a) => a.id === null)).toBe(true); // Deleted agents row
  });

  it("makes the dashboard reconcile: Σ by agent = Total cost = Σ by model; most active is Security Reviewer", async () => {
    const svc = new PerformanceService({ performanceRepo: new PerformanceRepository(db()) } as never);
    for (const kind of ["30d", "1d"] as const) {
      const out = await svc.dashboard(workspaceId, resolveWindow({ kind }, "UTC", NOW));
      const sum = (xs: { costUsd: number }[]) => xs.reduce((s, x) => s + x.costUsd, 0);
      expect(sum(out.costByAgent)).toBeCloseTo(out.kpis.totalCostUsd, 6);
      expect(sum(out.costByModel)).toBeCloseTo(out.kpis.totalCostUsd, 6);
      expect(out.agents.reduce((s, a) => s + a.runs, 0)).toBe(out.kpis.totalRuns);
    }
    const month = await svc.dashboard(workspaceId, resolveWindow({ kind: "30d" }, "UTC", NOW));
    expect(month.kpis.mostActive?.name).toBe("Security Reviewer");
    expect(month.kpis.totalRuns).toBeGreaterThan(100);
    expect(month.kpis.costDeltaUsd).not.toBeNull(); // history covers the previous window
    const day = await svc.dashboard(workspaceId, resolveWindow({ kind: "1d" }, "UTC", NOW));
    expect(day.kpis.totalRuns).toBeGreaterThan(0); // the 1-day view has data
  });

  it("spreads skill usage unevenly (not a flat 100%) and records memory pulls", async () => {
    const repo = new PerformanceRepository(db());
    const [security] = await db().select().from(t.agents).where(eq(t.agents.name, "Security Reviewer"));
    const range = { from: new Date(NOW.getTime() - 30 * 86_400_000), to: NOW };
    const skills = await repo.skillUsage(workspaceId, range, security!.id);
    expect(skills.length).toBe(5);
    const rates = skills.map((s) => s.applied / s.loaded);
    expect(Math.max(...rates)).toBeGreaterThan(0.8);
    expect(Math.min(...rates)).toBeLessThan(0.5);
    const memory = await repo.memoryUsage(workspaceId, range, security!.id);
    expect(memory.length).toBeGreaterThan(2);
    expect(new Set(memory.map((m) => m.pulled)).size).toBeGreaterThan(1);
  });
});
