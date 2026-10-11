import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMemoryPg, type MemoryPgFixture } from "../../../test/helpers/memory-pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import * as t from "../../db/schema.js";
import { PerformanceService } from "./service.js";
import { resolveWindow } from "./window.js";
import {
  NOW,
  addAgent,
  addReviewWithFindings,
  addRun,
  createWorld,
  daysAgo,
  type World,
} from "./it-fixtures.js";

const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

describe("performance aggregation (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let svc: PerformanceService;

  const w30 = resolveWindow({ kind: "30d" }, "UTC", NOW);
  const w1d = resolveWindow({ kind: "1d" }, "UTC", NOW);

  beforeAll(async () => {
    pg = await startMemoryPg();
    app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });
    svc = new PerformanceService(app.container);
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  it("counts only finished runs: done, failed, ci, multi-agent — not running/cancelled (AC-15)", async () => {
    const w: World = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    for (const status of ["done", "failed", "succeeded", "no_findings", "running", "cancelled"]) {
      await addRun(db(), w, { agentId: a, ranAt: daysAgo(2), status, costUsd: 1 });
    }
    const out = await svc.dashboard(w.ws, w30);
    expect(out.kpis.totalRuns).toBe(4);
    expect(out.kpis.totalCostUsd).toBeCloseTo(4, 9); // running/cancelled cost excluded
    expect(out.agents.find((r) => r.id === a)!.runs).toBe(4);
  });

  it("sums cost over known-cost runs and reports runs without cost (AC-16)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 0.1 });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 0.2 });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: null });
    const row = (await svc.dashboard(w.ws, w30)).agents[0]!;
    expect(row.totalCostUsd).toBeCloseTo(0.3, 9);
    expect(row.avgCostUsd).toBeCloseTo(0.15, 9);
    expect(row.runsWithoutCost).toBe(1);
  });

  it("averages duration over successful runs only (AC-17)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "done", durationMs: 2000 });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "done", durationMs: 4000 });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "failed", durationMs: 100 });
    expect((await svc.dashboard(w.ws, w30)).agents[0]!.avgDurationMs).toBe(3000);
  });

  it("accept rate = accepted / (accepted + dismissed), unresolved and CI excluded (AC-18)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1) });
    await addReviewWithFindings(db(), w, { agentId: a, runId: run.id }, [
      { accepted: true },
      { accepted: true },
      { accepted: true },
      { dismissed: true },
      {}, // unresolved
      {},
    ]);
    const row = (await svc.dashboard(w.ws, w30)).agents[0]!;
    expect(row.accept).toEqual({ accepted: 3, resolved: 4 });
  });

  it("assigns a finding to the window by run time, with a review-time fallback (AC-20)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const oldRun = await addRun(db(), w, { agentId: a, ranAt: daysAgo(45) });
    await addReviewWithFindings(db(), w, { agentId: a, runId: oldRun.id }, [{ accepted: true }]);
    // no run link: falls back to the review's own agent + created_at
    await addReviewWithFindings(db(), w, { agentId: a, runId: null, createdAt: daysAgo(3) }, [
      { accepted: true },
      { dismissed: true },
    ]);
    const row = (await svc.dashboard(w.ws, w30)).agents[0]!;
    expect(row.accept).toEqual({ accepted: 1, resolved: 2 });
  });

  it("excludes findings of a run that does not count (running)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    await addReviewWithFindings(db(), w, { agentId: a, runId: run.id }, [{ accepted: true }]);
    expect((await svc.dashboard(w.ws, w30)).agents[0]!.accept).toEqual({ accepted: 0, resolved: 0 });
  });

  it("a dashboard row equals that agent's Stats KPIs for the same window (AC-21, AC-8)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    await addAgent(db(), w, "B");
    const r1 = await addRun(db(), w, { agentId: a, ranAt: daysAgo(2), costUsd: 0.4, durationMs: 1000, costSource: "api" });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(5), costUsd: 0.1, durationMs: 3000, costSource: "estimate" });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(6), status: "failed" });
    await addReviewWithFindings(db(), w, { agentId: a, runId: r1.id }, [{ accepted: true }, { dismissed: true }]);

    for (const win of [w30, w1d, resolveWindow({ kind: "custom", from: daysAgo(10), to: NOW }, "UTC", NOW)]) {
      const dash = await svc.dashboard(w.ws, win);
      const stats = await svc.agentStats(w.ws, a, win);
      const row = dash.agents.find((r) => r.id === a)!;
      expect(stats.window.from).toBe(dash.window.from);
      expect(stats.window.buckets).toEqual(dash.window.buckets);
      const { sparkline: _s, avgCostDeltaUsd: _d, ...kpis } = stats.kpis;
      const { id: _i, name: _n, enabled: _e, recentRuns: _r, ...rowKpis } = row;
      const { recentRuns: _kr, ...statsKpis } = kpis as typeof kpis & { recentRuns?: unknown };
      expect(statsKpis).toEqual(rowKpis);
    }
  });

  it("Σ by agent = Total cost = Σ by model, at full precision (AC-37)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const b = await addAgent(db(), w, "B");
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 0.1, model: "m1" });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 0.2, model: "m2" });
    await addRun(db(), w, { agentId: b, ranAt: daysAgo(1), costUsd: 0.0001, model: "m1" });
    await addRun(db(), w, { agentId: null, ranAt: daysAgo(1), costUsd: 0.3, model: null }); // deleted agent, no model
    const out = await svc.dashboard(w.ws, w30);
    const sum = (xs: { costUsd: number }[]) => xs.reduce((s, x) => s + x.costUsd, 0);
    expect(out.kpis.totalCostUsd).toBeCloseTo(0.6001, 9);
    expect(sum(out.costByAgent)).toBeCloseTo(out.kpis.totalCostUsd, 9);
    expect(sum(out.costByModel)).toBeCloseTo(out.kpis.totalCostUsd, 9);
    expect(out.costByAgent.some((s) => s.kind === "deleted")).toBe(true);
    expect(out.costByModel.some((s) => s.kind === "unknown_model")).toBe(true);
  });

  it("more than 7 models → 6 + Other and the sum still equals Total cost (AC-38)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    for (let i = 0; i < 9; i++) {
      await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 1 + i / 10, model: `model-${i}` });
    }
    const out = await svc.dashboard(w.ws, w30);
    expect(out.costByModel).toHaveLength(7);
    expect(out.costByModel[6]!.kind).toBe("other");
    expect(out.costByModel[6]!.hidden).toHaveLength(3);
    const sum = out.costByModel.reduce((s, x) => s + x.costUsd, 0);
    expect(sum).toBeCloseTo(out.kpis.totalCostUsd, 9);
  });

  it("lists every agent, including ones without runs, plus a Deleted-agents row (AC-27, AC-28)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const idle = await addAgent(db(), w, "Idle", { enabled: false });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 1 });
    await addRun(db(), w, { agentId: null, ranAt: daysAgo(1), costUsd: 2 });
    const out = await svc.dashboard(w.ws, w30);
    expect(out.agents.map((r) => r.name).sort()).toEqual(["A", "Deleted agents", "Idle"]);
    const idleRow = out.agents.find((r) => r.id === idle)!;
    expect(idleRow).toMatchObject({ runs: 0, avgCostUsd: null, avgDurationMs: null, lastRunAt: null, enabled: false });
    expect(out.agents.reduce((s, r) => s + r.runs, 0)).toBe(out.kpis.totalRuns);
    expect(out.agents.reduce((s, r) => s + r.totalCostUsd, 0)).toBeCloseTo(out.kpis.totalCostUsd, 9);
  });

  it("Most-active agent: ties go to the later last run; Deleted agents is never eligible (AC-25)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const b = await addAgent(db(), w, "B");
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(5) });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(4) });
    await addRun(db(), w, { agentId: b, ranAt: daysAgo(6) });
    await addRun(db(), w, { agentId: b, ranAt: daysAgo(1) });
    for (let i = 0; i < 5; i++) await addRun(db(), w, { agentId: null, ranAt: daysAgo(2) });
    const out = await svc.dashboard(w.ws, w30);
    expect(out.kpis.mostActive?.agentId).toBe(b);
  });

  it("Avg accept rate is one fraction over all agents, not a mean of rates (AC-24)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const b = await addAgent(db(), w, "B");
    const ra = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1) });
    const rb = await addRun(db(), w, { agentId: b, ranAt: daysAgo(1) });
    await addReviewWithFindings(db(), w, { agentId: a, runId: ra.id }, [
      ...Array.from({ length: 9 }, () => ({ accepted: true })),
      { dismissed: true },
    ]);
    await addReviewWithFindings(db(), w, { agentId: b, runId: rb.id }, [{ accepted: true }, { dismissed: true }]);
    expect((await svc.dashboard(w.ws, w30)).kpis.accept).toEqual({ accepted: 10, resolved: 12 });
  });

  it("Total cost delta needs full history; Avg cost delta needs ≥ 5 costed previous runs (AC-26, AC-43)", async () => {
    const short = await createWorld(db());
    const sa = await addAgent(db(), short, "A");
    await addRun(db(), short, { agentId: sa, ranAt: daysAgo(20), costUsd: 1 });
    expect((await svc.dashboard(short.ws, w30)).kpis.costDeltaUsd).toBeNull();

    const long = await createWorld(db());
    const la = await addAgent(db(), long, "A");
    await addRun(db(), long, { agentId: la, ranAt: daysAgo(65), costUsd: 9 }); // history only: before the previous window
    await addRun(db(), long, { agentId: la, ranAt: daysAgo(40), costUsd: 1 }); // inside the previous window
    await addRun(db(), long, { agentId: la, ranAt: daysAgo(10), costUsd: 3 });
    expect((await svc.dashboard(long.ws, w30)).kpis.costDeltaUsd).toBeCloseTo(2, 9);

    const few = await createWorld(db());
    const fa = await addAgent(db(), few, "A");
    for (let i = 0; i < 4; i++) await addRun(db(), few, { agentId: fa, ranAt: daysAgo(40 + i), costUsd: 0.1 });
    await addRun(db(), few, { agentId: fa, ranAt: daysAgo(2), costUsd: 0.2 });
    expect((await svc.agentStats(few.ws, fa, w30)).kpis.avgCostDeltaUsd).toBeNull();
    await addRun(db(), few, { agentId: fa, ranAt: daysAgo(45), costUsd: 0.1 });
    expect((await svc.agentStats(few.ws, fa, w30)).kpis.avgCostDeltaUsd).toBeCloseTo(0.1, 9);
  });

  it("recent runs for the row expand are only runs inside the window (AC-34)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(50) });
    const inside = await addRun(db(), w, { agentId: a, ranAt: daysAgo(3) });
    const row = (await svc.dashboard(w.ws, w30)).agents[0]!;
    expect(row.recentRuns.map((r) => r.id)).toEqual([inside.id]);
  });

  it("cost-source badge uses only runs with a recorded source (AC-22, AC-80)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 1, costSource: null });
    expect((await svc.dashboard(w.ws, w30)).kpis.costSource).toBeNull();
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 1, costSource: "api" });
    expect((await svc.dashboard(w.ws, w30)).kpis.costSource).toBe("billed");
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), costUsd: 1, costSource: "estimate" });
    expect((await svc.dashboard(w.ws, w30)).kpis.costSource).toBe("mixed");
  });

  it("an empty workspace reports hasAnyRuns=false; runs outside the window keep it true (AC-60, AC-61)", async () => {
    const w = await createWorld(db());
    await addAgent(db(), w, "A");
    expect((await svc.dashboard(w.ws, w30)).hasAnyRuns).toBe(false);
    const [a] = await db().select().from(t.agents);
    await addRun(db(), w, { agentId: a!.id, ranAt: daysAgo(90) });
    const out = await svc.dashboard(w.ws, w30);
    expect(out.hasAnyRuns).toBe(true);
    expect(out.kpis.totalRuns).toBe(0);
  });

  it("agent stats: severity buckets include CI findings, categories are always 5, zero-filled (AC-47, AC-48, AC-69)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1) });
    await addReviewWithFindings(db(), w, { agentId: a, runId: run.id }, [
      { severity: "CRITICAL", category: "security", accepted: true },
      { severity: "WARNING", category: "bug" },
    ]);
    const [ciRun] = await db()
      .insert(t.ciRuns)
      .values({ prNumber: 7, ranAt: daysAgo(1), status: "succeeded", githubUrl: `https://x/${Math.random()}` })
      .returning();
    await db().insert(t.ciRunFindings).values({
      ciRunId: ciRun!.id,
      file: "c.ts",
      startLine: 1,
      endLine: 1,
      severity: "SUGGESTION",
      category: "style",
      title: "ci finding",
      rationale: "r",
      confidence: 0.5,
    });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), source: "ci", ciRunId: ciRun!.id, status: "succeeded" });

    const stats = await svc.agentStats(w.ws, a, w30);
    const totals = stats.severityBuckets.reduce(
      (s, b) => ({ c: s.c + b.critical, w: s.w + b.warning, s: s.s + b.suggestion }),
      { c: 0, w: 0, s: 0 },
    );
    expect(totals).toEqual({ c: 1, w: 1, s: 1 });
    expect(stats.severityBuckets).toHaveLength(5);
    expect(stats.categories.map((c) => c.category)).toEqual(["security", "bug", "perf", "style", "test"]);
    expect(stats.categories.map((c) => c.count)).toEqual([1, 1, 0, 1, 0]);
    expect(stats.findingsTotal).toBe(3);
    // accept rate stays local-only: the CI finding never enters it
    expect(stats.kpis.accept).toEqual({ accepted: 1, resolved: 1 });
  });

  it("most-used skills and most-pulled memory, with legacy runs excluded (AC-44, AC-45, AC-80)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const [skill] = await db()
      .insert(t.skills)
      .values({ workspaceId: w.ws, name: "sk", description: "d", type: "custom", source: "manual", body: "b" })
      .returning();
    const [mem] = await db()
      .insert(t.memory)
      .values({ workspaceId: w.ws, scope: "global", kind: "fact", content: "remember this", confidence: 0.9 })
      .returning();

    const runs = [];
    for (let i = 0; i < 4; i++) {
      runs.push(await addRun(db(), w, { agentId: a, ranAt: daysAgo(i + 1), memoryMode: i === 3 ? null : "top_k" }));
    }
    // skill loaded in 3 runs, applied in 2
    for (let i = 0; i < 3; i++) {
      await db().insert(t.agentRunSkills).values({
        runId: runs[i]!.id,
        skillId: skill!.id,
        skillVersion: 1,
        applied: i < 2,
        findingsCited: 0,
      });
    }
    // memory pulled in 1 of the 3 tracked runs (one tracked run pulled nothing)
    await db().insert(t.agentRunMemory).values({ runId: runs[0]!.id, memoryId: mem!.id, rank: 1, similarity: 0.9 });

    const stats = await svc.agentStats(w.ws, a, w30);
    expect(stats.skills).toEqual([{ skillId: skill!.id, name: "sk", applied: 2, loaded: 3 }]);
    expect(stats.memory).toHaveLength(1);
    expect(stats.memory[0]).toMatchObject({ pulled: 1, tracked: 3 }); // legacy run (mode null) excluded
    expect(stats.skillsTrackingSince).not.toBeNull();
    expect(stats.memoryTrackingSince).not.toBeNull();
  });

  it("skill stats: Used by ignores the period; findings attributed via rule_refs (AC-54…AC-57)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const [s1] = await db()
      .insert(t.skills)
      .values({ workspaceId: w.ws, name: "s1", description: "d", type: "custom", source: "manual", body: "b" })
      .returning();
    const [s2] = await db()
      .insert(t.skills)
      .values({ workspaceId: w.ws, name: "s2", description: "d", type: "custom", source: "manual", body: "b" })
      .returning();
    await db().insert(t.agentSkills).values({ agentId: a, skillId: s1!.id, order: 0 });

    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), prId: w.prIds[0]! });
    const run2 = await addRun(db(), w, { agentId: a, ranAt: daysAgo(2), prId: w.prIds[1]! });
    for (const [r, applied] of [[run, true], [run2, false]] as const) {
      await db().insert(t.agentRunSkills).values({ runId: r.id, skillId: s1!.id, skillVersion: 1, applied, findingsCited: 0 });
    }
    await addReviewWithFindings(db(), w, { agentId: a, runId: run.id }, [
      { category: "security", accepted: true, ruleRefs: [s1!.id, s2!.id] }, // cites both skills
      { category: "bug", dismissed: true, ruleRefs: [s1!.id] },
      { category: "style", accepted: true }, // cites none
    ]);

    const win = await svc.dashboard(w.ws, w30).then(() => w30);
    const stats1 = toSkill(await repoSkill(svc, w.ws, s1!.id, win));
    expect(stats1.usedBy).toBe(1);
    expect(stats1.pullFrequency).toEqual({ prsApplied: 1, prsLoaded: 2 });
    expect(stats1.accept).toEqual({ accepted: 1, resolved: 2 });
    expect(stats1.findings).toBe(2);
    expect(stats1.categories.map((c) => c.count)).toEqual([1, 1, 0, 0, 0]);

    const stats2 = toSkill(await repoSkill(svc, w.ws, s2!.id, win));
    expect(stats2.findings).toBe(1); // counted for each skill it cites
    expect(stats2.usedBy).toBe(0);

    // changing the period changes ranInPeriod, never usedBy
    const narrow = resolveWindow({ kind: "1d" }, "UTC", NOW);
    const stats1d = toSkill(await repoSkill(svc, w.ws, s1!.id, narrow));
    expect(stats1d.usedBy).toBe(1);
    expect(stats1d.ranInPeriod).toBe(0);
  });

  it("skillAggregatesAllTime matches skillStats for a skill with no window (batched list view)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const [s] = await db()
      .insert(t.skills)
      .values({ workspaceId: w.ws, name: "s", description: "d", type: "custom", source: "manual", body: "b" })
      .returning();
    await db().insert(t.agentSkills).values({ agentId: a, skillId: s!.id, order: 0 });
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), prId: w.prIds[0]! });
    await db().insert(t.agentRunSkills).values({ runId: run.id, skillId: s!.id, skillVersion: 1, applied: true, findingsCited: 1 });
    await addReviewWithFindings(db(), w, { agentId: a, runId: run.id }, [{ accepted: true, ruleRefs: [s!.id] }]);

    const all = (await app.container.performanceRepo.skillAggregatesAllTime(w.ws)).get(s!.id)!;
    const wide = { from: new Date(0), to: new Date("2100-01-01T00:00:00Z") };
    const one = (await app.container.performanceRepo.skillStats(w.ws, s!.id, wide))!;
    expect(all).toEqual({
      prsApplied: one.prsApplied,
      prsLoaded: one.prsLoaded,
      accepted: one.accept.accepted,
      resolved: one.accept.resolved,
    });
  });

  it("is workspace-scoped: another workspace's agent or skill is not found", async () => {
    const mine = await createWorld(db());
    const other = await createWorld(db());
    const foreign = await addAgent(db(), other, "Foreign");
    await expect(svc.agentStats(mine.ws, foreign, w30)).rejects.toMatchObject({ statusCode: 404 });
    expect(await app.container.performanceRepo.skillStats(mine.ws, foreign, { from: new Date(0), to: NOW })).toBeUndefined();
  });
});

// ---- tiny adapters so the skill test reads cleanly --------------------------

import type { SkillStatsData } from "./helpers.js";
import { toSkillStatsResponse } from "./helpers.js";
import type { StatsWindow } from "@devdigest/shared";

async function repoSkill(svc: PerformanceService, ws: string, id: string, win: StatsWindow): Promise<SkillStatsData> {
  const repo = (svc as unknown as { repo: import("./repository.js").PerformanceRepository }).repo;
  const data = await repo.skillStats(ws, id, { from: new Date(win.from), to: new Date(win.to) });
  if (!data) throw new Error("skill not found");
  return data;
}

function toSkill(data: SkillStatsData) {
  const res = toSkillStatsResponse(
    resolveWindow({ kind: "30d" }, "UTC", NOW),
    data,
  );
  return res;
}
