import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AuthProvider, Embedder, LLMProvider } from "@devdigest/shared";
import { startMemoryPg, type MemoryPgFixture } from "../../../test/helpers/memory-pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { CiService } from "../ci/service.js";
import { addAgent, addRun, createWorld, type World } from "./it-fixtures.js";

const config = () => loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

/**
 * AC-13 / AC-14: the stats endpoints are GET-only and DB-only. Any attempt to
 * call a model, an embedder, a review runner or the CI import on a read path
 * fails these spies. HTTP-level: validation (400) and routing are covered here too.
 */
describe("performance routes are read-only and validate input (in-memory Postgres)", () => {
  let pg: MemoryPgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let world: World;
  let agentId: string;
  let runId: string;

  const llmSpy = vi.fn();
  const embedSpy = vi.fn();
  const ciSpy = vi.spyOn(CiService.prototype, "ingestAll");

  const llm = new Proxy({} as LLMProvider, {
    get: (_t, prop) => (...args: unknown[]) => {
      llmSpy(prop, ...args);
      throw new Error(`LLM must not be called on a read path (${String(prop)})`);
    },
  });
  const embedder: Embedder = {
    dims: 1536,
    embed: async (...args) => {
      embedSpy(...args);
      throw new Error("embedder must not be called on a read path");
    },
  };

  beforeAll(async () => {
    pg = await startMemoryPg();
    world = await createWorld(pg.handle.db);
    const auth: AuthProvider = {
      currentUser: async () => ({ id: "00000000-0000-4000-8000-0000000000aa", email: "t@t", name: "t" }),
      currentWorkspace: async () => ({ id: world.ws, name: "perf" }),
    };
    agentId = await addAgent(pg.handle.db, world, "A");
    const run = await addRun(pg.handle.db, world, { agentId, ranAt: new Date(Date.now() - 3_600_000), costUsd: 0.1 });
    runId = run.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { auth, embedder, llm: { openai: llm, anthropic: llm, openrouter: llm } },
    });
  });
  afterAll(async () => {
    ciSpy.mockRestore();
    await app?.close();
    await pg?.stop();
  });

  const get = (url: string) => app.inject({ method: "GET", url });
  const Q = "tz=UTC";

  it("every stats GET returns 200 without calling an LLM, the embedder or the CI import", async () => {
    const urls = [
      `/agent-performance?range=30d&${Q}`,
      `/agent-performance?range=1d&${Q}`,
      `/agents/${agentId}/stats?range=30d&${Q}`,
      `/agents/${agentId}/runs?range=30d&${Q}&limit=10`,
      `/runs/${runId}/findings`,
    ];
    for (const url of urls) {
      const res = await get(url);
      expect(res.statusCode, `${url} → ${res.body}`).toBe(200);
    }
    expect(llmSpy).not.toHaveBeenCalled();
    expect(embedSpy).not.toHaveBeenCalled();
    expect(ciSpy).not.toHaveBeenCalled();
  });

  it("responses match their contracts and carry the resolved window", async () => {
    const res = await get(`/agent-performance?range=30d&${Q}`);
    const body = res.json();
    expect(body.window.kind).toBe("30d");
    expect(body.window.buckets).toHaveLength(5);
    expect(body.kpis.totalRuns).toBe(1);
    expect(body.hasAnyRuns).toBe(true);
  });

  it("answers 400 (not 422) to malformed periods, time zones and paging (AC-7, AC-52)", async () => {
    const bad = [
      `/agent-performance?range=7d&${Q}`,
      `/agent-performance?range=30d&tz=Mars/Base`,
      `/agent-performance?range=30d`,
      `/agent-performance?${Q}`,
      `/agent-performance?from=2026-09-01T00:00:00Z&to=2026-10-12T00:00:00Z&${Q}`, // > 30 days
      `/agent-performance?from=2026-10-05T00:00:00Z&to=2026-10-04T00:00:00Z&${Q}`, // to < from
      `/agents/${agentId}/runs?range=30d&${Q}&limit=51`,
      `/agents/${agentId}/runs?range=30d&${Q}&cursor=garbage`,
    ];
    for (const url of bad) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code).toBe("bad_request");
    }
  });

  it("an invalid id is a schema error (422) and an unknown agent is a 404", async () => {
    expect((await get(`/agents/not-a-uuid/stats?range=30d&${Q}`)).statusCode).toBe(422);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await get(`/agents/${unknown}/stats?range=30d&${Q}`)).statusCode).toBe(404);
    expect((await get(`/runs/${unknown}/findings`)).statusCode).toBe(404);
  });

  it("exposes no write verbs on the stats paths", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await app.inject({ method, url: `/agent-performance?range=30d&${Q}` });
      expect(res.statusCode, method).toBe(404);
    }
  });
});
