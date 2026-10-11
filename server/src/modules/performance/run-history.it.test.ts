import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMemoryPg, type MemoryPgFixture } from "../../../test/helpers/memory-pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import * as t from "../../db/schema.js";
import { PerformanceService } from "./service.js";
import { parsePageQuery } from "./query.js";
import { resolveWindow } from "./window.js";
import { NOW, addAgent, addReviewWithFindings, addRun, createWorld, daysAgo } from "./it-fixtures.js";

const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

describe("run history + run findings (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let svc: PerformanceService;
  const w30 = resolveWindow({ kind: "30d" }, "UTC", NOW);
  const db = () => pg.handle.db;
  const page = (limit: number, cursor?: string) =>
    parsePageQuery({ limit: String(limit), ...(cursor ? { cursor } : {}) });

  beforeAll(async () => {
    pg = await startMemoryPg();
    app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });
    svc = new PerformanceService(app.container);
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it("pages newest-first and a run inserted between pages neither duplicates nor skips (AC-52)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push((await addRun(db(), w, { agentId: a, ranAt: daysAgo(i) })).id); // newest first = ids[0]
    }

    const first = await svc.agentRuns(w.ws, a, w30, page(2));
    expect(first.items.map((r) => r.id)).toEqual([ids[0], ids[1]]);
    expect(first.nextCursor).not.toBeNull();

    // a NEWER run appears while the user is scrolling
    const fresh = await addRun(db(), w, { agentId: a, ranAt: new Date(NOW.getTime() - 60_000) });

    const second = await svc.agentRuns(w.ws, a, w30, page(2, first.nextCursor!));
    expect(second.items.map((r) => r.id)).toEqual([ids[2], ids[3]]);
    const third = await svc.agentRuns(w.ws, a, w30, page(2, second.nextCursor!));
    expect(third.items.map((r) => r.id)).toEqual([ids[4]]);
    expect(third.nextCursor).toBeNull();

    const seen = [...first.items, ...second.items, ...third.items].map((r) => r.id);
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(seen).not.toContain(fresh.id); // new rows only appear after a refetch
  });

  it("keeps runs with the same timestamp in a stable order across pages", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const sameTime = daysAgo(1);
    for (let i = 0; i < 5; i++) await addRun(db(), w, { agentId: a, ranAt: sameTime });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const p = await svc.agentRuns(w.ws, a, w30, page(2, cursor));
      seen.push(...p.items.map((r) => r.id));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("only returns runs inside the window and of the requested agent", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");
    const b = await addAgent(db(), w, "B");
    const inside = await addRun(db(), w, { agentId: a, ranAt: daysAgo(3) });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(50) });
    await addRun(db(), w, { agentId: b, ranAt: daysAgo(3) });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(3), status: "running" });
    const out = await svc.agentRuns(w.ws, a, w30, page(10));
    expect(out.items.map((r) => r.id)).toEqual([inside.id]);
  });

  it("shapes local, failed and CI rows (AC-51, AC-53)", async () => {
    const w = await createWorld(db());
    const a = await addAgent(db(), w, "A");

    const local = await addRun(db(), w, {
      agentId: a,
      ranAt: daysAgo(1),
      costUsd: 0.06,
      costSource: "api",
      tokensIn: 100,
      tokensOut: 50,
      findingsCount: 3,
      prId: w.prIds[0]!,
    });
    await db().insert(t.runTraces).values({ runId: local.id, trace: {} });
    await addRun(db(), w, { agentId: a, ranAt: daysAgo(2), status: "failed", error: "quota exceeded" });

    const [inst] = await db().insert(t.ciInstallations).values({ agentId: a, repo: "acme/web", targetType: "gha" }).returning();
    const [ciRun] = await db()
      .insert(t.ciRuns)
      .values({
        ciInstallationId: inst!.id,
        prNumber: 42,
        ranAt: daysAgo(3),
        status: "succeeded",
        githubUrl: "https://github.com/acme/web/actions/runs/1",
      })
      .returning();
    const ci = await addRun(db(), w, {
      agentId: a,
      ranAt: daysAgo(3),
      status: "succeeded",
      source: "ci",
      ciRunId: ciRun!.id,
      model: null,
      prId: null,
    });
    // an old CI row imported before ci_run_id existed
    const legacyCi = await addRun(db(), w, { agentId: a, ranAt: daysAgo(4), status: "succeeded", source: "ci", prId: null });

    const items = (await svc.agentRuns(w.ws, a, w30, page(10))).items;
    const byId = new Map(items.map((i) => [i.id, i]));

    expect(byId.get(local.id)).toMatchObject({
      source: "local",
      hasTrace: true,
      costSource: "api",
      tokensIn: 100,
      tokensOut: 50,
      findingsCount: 3,
      pr: { number: 1, repoId: w.repoId, githubUrl: null },
      ciRunUrl: null,
    });
    expect(items.find((i) => i.status === "failed")).toMatchObject({ error: "quota exceeded", hasTrace: false });
    expect(byId.get(ci.id)).toMatchObject({
      source: "ci",
      hasTrace: false,
      costSource: null,
      ciRunUrl: "https://github.com/acme/web/actions/runs/1",
      pr: { number: 42, repoId: null, githubUrl: "https://github.com/acme/web/pull/42" },
    });
    // legacy CI row: nothing to link to
    expect(byId.get(legacyCi.id)).toMatchObject({ source: "ci", pr: null, ciRunUrl: null });
  });

  it("rejects an unknown agent with 404", async () => {
    const mine = await createWorld(db());
    const other = await createWorld(db());
    const foreign = await addAgent(db(), other, "Foreign");
    await expect(svc.agentRuns(mine.ws, foreign, w30, page(10))).rejects.toMatchObject({ statusCode: 404 });
  });

  it("GET /runs/:id/findings returns the run's findings; another workspace's run is a 404 (AC-53)", async () => {
    const mine = await createWorld(db());
    const a = await addAgent(db(), mine, "A");
    const run = await addRun(db(), mine, { agentId: a, ranAt: daysAgo(1) });
    await addReviewWithFindings(db(), mine, { agentId: a, runId: run.id }, [
      { severity: "CRITICAL", category: "security", accepted: true },
      { severity: "WARNING", category: "bug" },
    ]);

    const out = await svc.runFindings(mine.ws, run.id);
    expect(out.items).toHaveLength(2);
    expect(out.items.map((f) => f.severity).sort()).toEqual(["CRITICAL", "WARNING"]);
    expect(out.items[0]).toHaveProperty("review_id");

    const other = await createWorld(db());
    await expect(svc.runFindings(other.ws, run.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.runFindings(mine.ws, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
