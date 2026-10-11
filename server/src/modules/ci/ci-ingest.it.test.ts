import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { AuthProvider } from "@devdigest/shared";
import { startMemoryPg, type MemoryPgFixture } from "../../../test/helpers/memory-pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { MockGitHubClient } from "../../adapters/mocks.js";
import * as t from "../../db/schema.js";
import { buildZip } from "./zip.js";
import { addAgent, createWorld, type World } from "../performance/it-fixtures.js";

/**
 * CI import → agent runs. A CI run must land in the stats at the time it
 * actually ran (not when it was imported), be linked to its CI run, and be
 * counted exactly once however often "Sync CI" is pressed. In-memory Postgres
 * (PGlite) + a mock GitHub: no Docker, no network, no real database.
 */
const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

const ARTIFACT = {
  findings_count: 1,
  critical: 1,
  warning: 0,
  suggestion: 0,
  cost_usd: 0.04,
  duration_ms: 3000,
  agent: "CI Agent",
  version: "1.0.0",
  pr_number: 42,
  findings: [
    {
      id: "f-1",
      file: "src/app.ts",
      start_line: 10,
      end_line: 10,
      severity: "CRITICAL",
      category: "security",
      title: "SQL injection",
      rationale: "Unparameterised query.",
      confidence: 0.95,
      kind: "finding",
    },
  ],
};
const zip = () => buildZip([{ path: "devdigest-result.json", contents: JSON.stringify(ARTIFACT) }]);

describe("CI ingest → agent runs (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let world: World;
  let agentId: string;
  let installationId: string;
  const db = () => pg.handle.db;

  beforeAll(async () => {
    pg = await startMemoryPg();
    world = await createWorld(pg.handle.db);
    agentId = await addAgent(pg.handle.db, world, "CI Agent");
    const [inst] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId, repo: "acme/web", targetType: "gha" })
      .returning();
    installationId = inst!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function refresh(workflowRuns: ConstructorParameters<typeof MockGitHubClient>[0]) {
    const auth: AuthProvider = {
      currentUser: async () => ({ id: "00000000-0000-4000-8000-0000000000aa", email: "t@t", name: "t" }),
      currentWorkspace: async () => ({ id: world.ws, name: "ci" }),
    };
    const app = await buildApp({
      config: config(),
      db: db(),
      overrides: { auth, github: new MockGitHubClient(workflowRuns) },
    });
    try {
      return await app.inject({ method: "POST", url: "/ci-runs/refresh", payload: {} });
    } finally {
      await app.close();
    }
  }

  const run = (over: Record<string, unknown> = {}) => ({
    id: 5001,
    status: "completed",
    conclusion: "success",
    prNumber: 42,
    headSha: "abc",
    htmlUrl: "https://github.com/acme/web/actions/runs/5001",
    artifacts: [{ id: 7001, name: "devdigest-result" }],
    runStartedAt: "2026-10-01T08:00:00Z",
    createdAt: "2026-10-01T07:59:00Z",
    ...over,
  });

  it("files the agent run at the CI run's own time and links it to the CI run", async () => {
    const res = await refresh({ workflowRuns: [run()], artifacts: { "7001": zip() } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ingested).toBe(1);

    const [ci] = await db().select().from(t.ciRuns).where(eq(t.ciRuns.githubUrl, "https://github.com/acme/web/actions/runs/5001"));
    expect(ci!.ranAt!.toISOString()).toBe("2026-10-01T08:00:00.000Z");

    const [ar] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.ciRunId, ci!.id));
    expect(ar).toMatchObject({ source: "ci", agentId, status: "succeeded", findingsCount: 1, costUsd: 0.04 });
    expect(ar!.ranAt.toISOString()).toBe("2026-10-01T08:00:00.000Z");
    // not tagged with a model/tokens/cost source it cannot know
    expect(ar!.model).toBeNull();
    expect(ar!.tokensIn).toBeNull();
    expect(ar!.costSource).toBeNull();
    // its findings are available to the severity/category charts
    expect(await db().select().from(t.ciRunFindings).where(eq(t.ciRunFindings.ciRunId, ci!.id))).toHaveLength(1);
  });

  it("a repeated Sync CI imports the same run once: no duplicate agent run, time unchanged", async () => {
    const before = await db().select().from(t.agentRuns).where(eq(t.agentRuns.source, "ci"));
    for (let i = 0; i < 3; i++) {
      await refresh({ workflowRuns: [run()], artifacts: { "7001": zip() } });
    }
    const after = await db().select().from(t.agentRuns).where(eq(t.agentRuns.source, "ci"));
    expect(after).toHaveLength(before.length);
    const [ci] = await db().select().from(t.ciRuns).where(eq(t.ciRuns.githubUrl, "https://github.com/acme/web/actions/runs/5001"));
    expect(ci!.ranAt!.toISOString()).toBe("2026-10-01T08:00:00.000Z");
  });

  it("a second CI run adds exactly one more agent run at its own time", async () => {
    await refresh({
      workflowRuns: [
        run(),
        run({
          id: 5002,
          htmlUrl: "https://github.com/acme/web/actions/runs/5002",
          artifacts: [{ id: 7002, name: "devdigest-result" }],
          runStartedAt: "2026-10-03T09:30:00Z",
        }),
      ],
      artifacts: { "7001": zip(), "7002": zip() },
    });
    const ci = await db().select().from(t.agentRuns).where(eq(t.agentRuns.source, "ci"));
    expect(ci).toHaveLength(2);
    expect(ci.map((r) => r.ranAt.toISOString()).sort()).toEqual([
      "2026-10-01T08:00:00.000Z",
      "2026-10-03T09:30:00.000Z",
    ]);
  });

  it("corrects a CI run first stored under its import time, and never moves it later", async () => {
    // simulate the old behaviour: the CI run was stored with the time of import
    const imported = new Date("2026-10-10T12:00:00Z");
    await db().update(t.ciRuns).set({ ranAt: imported }).where(eq(t.ciRuns.githubUrl, "https://github.com/acme/web/actions/runs/5001"));
    await refresh({ workflowRuns: [run()], artifacts: { "7001": zip() } });
    const [fixed] = await db().select().from(t.ciRuns).where(eq(t.ciRuns.githubUrl, "https://github.com/acme/web/actions/runs/5001"));
    expect(fixed!.ranAt!.toISOString()).toBe("2026-10-01T08:00:00.000Z");

    // a later report of a LATER time (e.g. a missing-field fallback to "now") must not push it forward
    await refresh({
      workflowRuns: [run({ runStartedAt: "2026-10-09T00:00:00Z" })],
      artifacts: { "7001": zip() },
    });
    const [still] = await db().select().from(t.ciRuns).where(eq(t.ciRuns.githubUrl, "https://github.com/acme/web/actions/runs/5001"));
    expect(still!.ranAt!.toISOString()).toBe("2026-10-01T08:00:00.000Z");
  });

  it("falls back to GitHub's creation time when the start time is missing", async () => {
    await refresh({
      workflowRuns: [
        run({
          id: 5003,
          htmlUrl: "https://github.com/acme/web/actions/runs/5003",
          artifacts: [{ id: 7003, name: "devdigest-result" }],
          runStartedAt: null,
          createdAt: "2026-09-20T05:00:00Z",
        }),
      ],
      artifacts: { "7003": zip() },
    });
    const [ci] = await db().select().from(t.ciRuns).where(eq(t.ciRuns.githubUrl, "https://github.com/acme/web/actions/runs/5003"));
    expect(ci!.ranAt!.toISOString()).toBe("2026-09-20T05:00:00.000Z");
  });

  it("installation bookkeeping is untouched", async () => {
    const [inst] = await db().select().from(t.ciInstallations).where(eq(t.ciInstallations.id, installationId));
    expect(inst!.lastSyncedAt).not.toBeNull();
  });
});
