import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AuthProvider } from "@devdigest/shared";
import { startMemoryPg, type MemoryPgFixture } from "../../../test/helpers/memory-pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import * as t from "../../db/schema.js";
import { addAgent, addReviewWithFindings, addRun, createWorld, type World } from "../performance/it-fixtures.js";

/**
 * Skill list + Skill Stats. The skills LIST (all-time, batched) and the Skill
 * Stats tab (per period) share one definition: pull frequency = PRs where the
 * skill was applied / PRs where it was loaded (local runs); accept rate = the
 * findings attributed to the skill via `rule_refs`, accepted / (accepted +
 * dismissed). Runs on an in-memory Postgres (PGlite) — no Docker, no real DB.
 */
const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const Q = "range=30d&tz=UTC";

describe("skill list + stats (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let world: World;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const db = () => pg.handle.db;

  beforeAll(async () => {
    pg = await startMemoryPg();
    world = await createWorld(pg.handle.db, 3);
    const auth: AuthProvider = {
      currentUser: async () => ({ id: "00000000-0000-4000-8000-0000000000aa", email: "t@t", name: "t" }),
      currentWorkspace: async () => ({ id: world.ws, name: "skills" }),
    };
    app = await buildApp({ config: config(), db: pg.handle.db, overrides: { auth } });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function skill(name: string) {
    const [s] = await db()
      .insert(t.skills)
      .values({ workspaceId: world.ws, name, description: "", type: "convention", source: "manual", body: "b" })
      .returning();
    return s!.id;
  }

  it("the list numbers match Skill Stats for the same skill (one definition, batched)", async () => {
    const agent = await addAgent(db(), world, "Skill-linked agent");
    const sk = await skill("Batched Stats Skill");
    await db().insert(t.agentSkills).values({ agentId: agent, skillId: sk, order: 0 });

    // PR1: applied; PR2: loaded but not applied → pull frequency 1/2 = 50%
    const r1 = await addRun(db(), world, { agentId: agent, ranAt: hoursAgo(5), prId: world.prIds[0]! });
    const r2 = await addRun(db(), world, { agentId: agent, ranAt: hoursAgo(4), prId: world.prIds[1]! });
    await db().insert(t.agentRunSkills).values([
      { runId: r1.id, skillId: sk, skillVersion: 1, applied: true, findingsCited: 2 },
      { runId: r2.id, skillId: sk, skillVersion: 1, applied: false, findingsCited: 0 },
    ]);
    // the skill's own findings: 1 accepted, 1 dismissed, 1 unresolved → 50%
    await addReviewWithFindings(db(), world, { agentId: agent, runId: r1.id }, [
      { accepted: true, ruleRefs: [sk] },
      { dismissed: true, ruleRefs: [sk] },
      { ruleRefs: [sk] },
      { accepted: true }, // not this skill's finding
    ]);

    const list = (await app.inject({ method: "GET", url: "/skills" })).json();
    const dto = list.find((s: { id: string }) => s.id === sk);
    expect(dto.agent_count).toBe(1);
    expect(dto.pull_frequency_pct).toBe(50);
    expect(dto.accept_rate_pct).toBe(50);

    const stats = (await app.inject({ method: "GET", url: `/skills/${sk}/stats?${Q}` })).json();
    expect(stats.usedBy).toBe(dto.agent_count);
    expect(stats.pullFrequency).toEqual({ prsApplied: 1, prsLoaded: 2 });
    expect(Math.round((stats.pullFrequency.prsApplied / stats.pullFrequency.prsLoaded) * 100)).toBe(dto.pull_frequency_pct);
    expect(stats.accept).toEqual({ accepted: 1, resolved: 2 });
    expect(Math.round((stats.accept.accepted / stats.accept.resolved) * 100)).toBe(dto.accept_rate_pct);
    expect(stats.findings).toBe(3);
    expect(stats.categories).toHaveLength(5);
    expect(stats.agents).toEqual([{ id: agent, name: "Skill-linked agent", enabled: true }]);
  });

  it("changing the period changes ranInPeriod, never usedBy; CI runs do not change pull frequency", async () => {
    const agent = await addAgent(db(), world, "Period agent");
    const sk = await skill("Period Skill");
    await db().insert(t.agentSkills).values({ agentId: agent, skillId: sk, order: 0 });
    const run = await addRun(db(), world, { agentId: agent, ranAt: hoursAgo(26), prId: world.prIds[0]! }); // outside "1 day"
    await db().insert(t.agentRunSkills).values({ runId: run.id, skillId: sk, skillVersion: 1, applied: true, findingsCited: 0 });
    // a CI run on another PR carries no skill data and must not move the fraction
    await addRun(db(), world, { agentId: agent, ranAt: hoursAgo(2), source: "ci", prId: world.prIds[2]!, status: "succeeded" });

    const month = (await app.inject({ method: "GET", url: `/skills/${sk}/stats?${Q}` })).json();
    expect(month.usedBy).toBe(1);
    expect(month.ranInPeriod).toBe(1);
    expect(month.pullFrequency).toEqual({ prsApplied: 1, prsLoaded: 1 });

    const day = (await app.inject({ method: "GET", url: `/skills/${sk}/stats?range=1d&tz=UTC` })).json();
    expect(day.usedBy).toBe(1); // period-independent
    expect(day.ranInPeriod).toBe(0);
    expect(day.hasAnyRuns).toBe(true);
  });

  it("a finding citing several skills counts for each; one citing none counts for none", async () => {
    const agent = await addAgent(db(), world, "Multi agent");
    const s1 = await skill("S-one");
    const s2 = await skill("S-two");
    const run = await addRun(db(), world, { agentId: agent, ranAt: hoursAgo(3) });
    await addReviewWithFindings(db(), world, { agentId: agent, runId: run.id }, [
      { category: "security", ruleRefs: [s1, s2] },
      { category: "style" },
    ]);
    const a = (await app.inject({ method: "GET", url: `/skills/${s1}/stats?${Q}` })).json();
    const b = (await app.inject({ method: "GET", url: `/skills/${s2}/stats?${Q}` })).json();
    expect(a.findings).toBe(1);
    expect(b.findings).toBe(1);
    expect(a.categories.map((c: { count: number }) => c.count)).toEqual([1, 0, 0, 0, 0]);
  });

  it("a skill with no run data has no invented percentages in the list", async () => {
    const sk = await skill("Never ran");
    const list = (await app.inject({ method: "GET", url: "/skills" })).json();
    const dto = list.find((s: { id: string }) => s.id === sk);
    expect(dto.agent_count).toBe(0);
    expect(dto).not.toHaveProperty("pull_frequency_pct");
    expect(dto).not.toHaveProperty("accept_rate_pct");
  });

  it("stats are read-only, validated and workspace-scoped", async () => {
    const sk = await skill("Scoped");
    expect((await app.inject({ method: "GET", url: `/skills/${sk}/stats` })).statusCode).toBe(400); // no period
    expect((await app.inject({ method: "GET", url: `/skills/${sk}/stats?range=7d&tz=UTC` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/skills/not-a-uuid/stats?${Q}` })).statusCode).toBe(422);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await app.inject({ method: "GET", url: `/skills/${unknown}/stats?${Q}` })).statusCode).toBe(404);
  });
});
