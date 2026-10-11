import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { startMemoryPg, type MemoryPgFixture } from "../../../test/helpers/memory-pg.js";
import * as t from "../../db/schema.js";
import { ReviewRepository } from "./repository.js";
import { addAgent, addRun, createWorld, daysAgo, type World } from "../performance/it-fixtures.js";

/**
 * What a review writes about itself: cost source, memory selection, per-skill
 * usage and findings' skill ids. Real SQL on an in-memory Postgres (PGlite) —
 * no Docker, no real database.
 */
describe("review run records (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let repo: ReviewRepository;
  let w: World;
  const db = () => pg.handle.db;

  beforeAll(async () => {
    pg = await startMemoryPg();
    repo = new ReviewRepository(pg.handle.db);
    w = await createWorld(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const finish = (runId: string, costSource?: "api" | "estimate" | null) =>
    repo.completeAgentRun(runId, {
      status: "done",
      durationMs: 1000,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.02,
      findingsCount: 0,
      grounding: "0/0 passed",
      ...(costSource !== undefined ? { costSource } : {}),
    });

  const row = async (runId: string) => (await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, runId)))[0]!;

  it("stores where the cost came from, and null when it is not given", async () => {
    const a = await addAgent(db(), w, "A");
    const billed = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    const estimated = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    const unknown = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    await finish(billed.id, "api");
    await finish(estimated.id, "estimate");
    await finish(unknown.id);
    expect((await row(billed.id)).costSource).toBe("api");
    expect((await row(estimated.id)).costSource).toBe("estimate");
    expect((await row(unknown.id)).costSource).toBeNull();
  });

  it("records the memory mode and the selected entries with rank and similarity", async () => {
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    const [m1, m2] = await db()
      .insert(t.memory)
      .values([
        { workspaceId: w.ws, scope: "global", kind: "fact", content: "one", confidence: 0.9 },
        { workspaceId: w.ws, scope: "global", kind: "fact", content: "two", confidence: 0.9 },
      ])
      .returning();
    await repo.setMemorySelection(run.id, "top_k", [
      { id: m1!.id, rank: 1, similarity: 0.91 },
      { id: m2!.id, rank: 2, similarity: 0.74 },
    ]);
    expect((await row(run.id)).memoryMode).toBe("top_k");
    const pulled = await db().select().from(t.agentRunMemory).where(eq(t.agentRunMemory.runId, run.id));
    expect(pulled.map((p) => [p.rank, p.similarity]).sort()).toEqual([[1, 0.91], [2, 0.74]]);
  });

  it("writes the mode even when nothing was selected, and is safe to repeat", async () => {
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    await repo.setMemorySelection(run.id, "top_k", []);
    await repo.setMemorySelection(run.id, "top_k", []);
    expect((await row(run.id)).memoryMode).toBe("top_k");
    expect(await db().select().from(t.agentRunMemory).where(eq(t.agentRunMemory.runId, run.id))).toHaveLength(0);
  });

  it("a fallback selection keeps a null similarity", async () => {
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    const [m] = await db()
      .insert(t.memory)
      .values({ workspaceId: w.ws, scope: "global", kind: "fact", content: "x", confidence: 0.9 })
      .returning();
    await repo.setMemorySelection(run.id, "fallback", [{ id: m!.id, rank: 1, similarity: null }]);
    expect((await row(run.id)).memoryMode).toBe("fallback");
    const [pulled] = await db().select().from(t.agentRunMemory).where(eq(t.agentRunMemory.runId, run.id));
    expect(pulled!.similarity).toBeNull();
  });

  it("records one row per loaded skill with version, applied and citations", async () => {
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1), status: "running" });
    const [s1, s2] = await db()
      .insert(t.skills)
      .values([
        { workspaceId: w.ws, name: "s1", description: "", type: "custom", source: "manual", body: "b" },
        { workspaceId: w.ws, name: "s2", description: "", type: "custom", source: "manual", body: "b" },
      ])
      .returning();
    await repo.insertRunSkills(run.id, [
      { skillId: s1!.id, skillVersion: 4, applied: true, findingsCited: 2 },
      { skillId: s2!.id, skillVersion: 1, applied: false, findingsCited: 0 },
    ]);
    const rows = await db().select().from(t.agentRunSkills).where(eq(t.agentRunSkills.runId, run.id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.skillId === s1!.id)).toMatchObject({ skillVersion: 4, applied: true, findingsCited: 2 });
    expect(rows.find((r) => r.skillId === s2!.id)).toMatchObject({ applied: false, findingsCited: 0 });
    await repo.insertRunSkills(run.id, []); // no skills loaded → nothing to write, no error
  });

  it("saves findings with their skill ids, null for a finding that cites none", async () => {
    const a = await addAgent(db(), w, "A");
    const run = await addRun(db(), w, { agentId: a, ranAt: daysAgo(1) });
    const [skill] = await db()
      .insert(t.skills)
      .values({ workspaceId: w.ws, name: "sk", description: "", type: "custom", source: "manual", body: "b" })
      .returning();
    const review = await repo.insertReview({
      workspaceId: w.ws,
      prId: w.prIds[0]!,
      agentId: a,
      runId: run.id,
      kind: "review",
      verdict: "comment",
      summary: "s",
      score: 90,
      model: "m",
    });
    const finding = (id: string) => ({
      id,
      severity: "WARNING" as const,
      category: "bug" as const,
      title: id,
      file: "a.ts",
      start_line: 1,
      end_line: 1,
      rationale: "r",
      confidence: 0.9,
    });
    const rows = await repo.insertFindings(review.id, [finding("f1"), finding("f2")], [[skill!.id], null]);
    expect(rows.map((r) => r.ruleRefs)).toEqual([[skill!.id], null]);
    // omitting the refs entirely (older callers) stores null
    const plain = await repo.insertFindings(review.id, [finding("f3")]);
    expect(plain[0]!.ruleRefs).toBeNull();
  });
});
