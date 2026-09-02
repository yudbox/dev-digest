import { describe, it, expect, vi } from "vitest";
import type { Container } from "../../platform/container.js";
import type { ReviewRepository, PullRow, ReviewRow } from "./repository.js";
import type { AgentRow } from "../../db/rows.js";
import { RunBus } from "../../platform/sse.js";

/**
 * AC-024: run-executor runs the background review pipeline (not an HTTP
 * handler) — when `agent.featureModelId` is set and the workspace has no
 * override configured, `resolveFeatureModelStrict` throws `ValidationError`.
 * This must abort only THAT agent's run (persisted as "failed") and let the
 * batch continue to the next queued agent, not crash the whole review run.
 * This is a deliberate, documented deviation from AC-14's literal "throw 422"
 * wording, scoped to this call site only (the `if (agent.featureModelId)`
 * branch — the no-override agent-default path is untouched).
 */

vi.mock("./diff-loader.js", () => ({
  loadDiff: vi.fn().mockResolvedValue({
    diff: {
      files: [
        {
          path: "src/a.ts",
          additions: 1,
          deletions: 0,
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 }],
        },
      ],
      raw: "diff --git a/src/a.ts b/src/a.ts",
    },
    resolvedHeadSha: "deadbeef",
  }),
}));

vi.mock("@devdigest/reviewer-core", () => ({
  reviewPullRequest: vi.fn().mockResolvedValue({
    review: { verdict: "approve", summary: "Looks good", score: 100, findings: [] },
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.001,
    grounding: "0/0 passed",
    assembly: {},
    chunks: [],
    mode: "single-pass",
    raw: "{}",
  }),
  countBlockers: vi.fn().mockReturnValue(0),
}));

const { ReviewRunExecutor } = await import("./run-executor.js");

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    workspaceId: "ws-1",
    name: "Agent 1",
    description: "",
    provider: "openai",
    model: "gpt-4o",
    systemPrompt: "review this",
    outputSchema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ciFailOn: "critical",
    repoIntel: false, // skip repo-intel enrichment — orthogonal to this test
    featureModelId: null,
    contextDocPaths: [],
    ...overrides,
  } as unknown as AgentRow;
}

function makeContainer(opts: { hasOverride: boolean }): Container {
  const runBus = new RunBus();
  return {
    runBus,
    llm: vi.fn().mockResolvedValue({
      id: "openai",
      completeStructured: vi.fn(),
      complete: vi.fn(),
    }),
    github: vi.fn().mockRejectedValue(new Error("no github token configured")),
    repoIntel: {
      getCallerSignatures: vi.fn().mockResolvedValue([]),
    },
    contextService: {
      readDocsByPaths: vi.fn().mockResolvedValue([]),
    },
    agentsRepo: {
      linkedSkills: vi.fn().mockResolvedValue([]),
    },
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(
            opts.hasOverride
              ? [
                  {
                    key: "feature_models",
                    value: {
                      onboarding: { provider: "openai", model: "gpt-4o" },
                    },
                  },
                ]
              : [],
          ),
        }),
      }),
    },
  } as unknown as Container;
}

function makeRepo(): ReviewRepository {
  return {
    getIntent: vi.fn().mockResolvedValue(null),
    upsertIntent: vi.fn().mockResolvedValue(undefined),
    insertReview: vi
      .fn()
      .mockResolvedValue({ id: "review-1" } as unknown as ReviewRow),
    insertFindings: vi.fn().mockResolvedValue([]),
    markReviewed: vi.fn().mockResolvedValue(undefined),
    completeAgentRun: vi.fn().mockResolvedValue(undefined),
    saveRunTrace: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReviewRepository;
}

describe("ReviewRunExecutor — feature-model strict resolution degrade", () => {
  it("isolates a per-agent ValidationError (no override) without crashing the batch", async () => {
    const container = makeContainer({ hasOverride: false });
    const repo = makeRepo();
    const executor = new ReviewRunExecutor(
      container,
      repo,
      container.agentsRepo,
    );

    // Only this agent is linked to a feature model — no override configured.
    const failingAgent = makeAgent({
      id: "agent-fail",
      featureModelId: "onboarding",
    });
    // Untouched by the retrofit: uses its own provider/model fields directly.
    const healthyAgent = makeAgent({ id: "agent-ok", featureModelId: null });

    const pull = {
      id: "pr-1",
      repoId: "repo-1",
      number: 1,
      title: "Test PR",
      body: null,
      base: "main",
      headSha: "sha1",
      lastReviewedSha: null,
    } as unknown as PullRow;

    const repoRow = {
      id: "repo-1",
      owner: "acme",
      name: "widgets",
      clonePath: "/tmp/mock-clone",
    } as unknown as Parameters<typeof executor.executeRuns>[2];

    await executor.executeRuns(
      "ws-1",
      pull,
      repoRow,
      [
        { agent: failingAgent, runId: "run-fail" },
        { agent: healthyAgent, runId: "run-ok" },
      ],
    );

    // Failing agent's run is persisted as "failed" — isolated, not thrown to caller.
    expect(repo.completeAgentRun).toHaveBeenCalledWith(
      "run-fail",
      expect.objectContaining({ status: "failed" }),
    );
    // Batch continues: the healthy agent (no featureModelId) still completes.
    expect(repo.completeAgentRun).toHaveBeenCalledWith(
      "run-ok",
      expect.objectContaining({ status: "done" }),
    );
    // The failing agent never reached the LLM call — it aborted before that.
    expect(container.llm).toHaveBeenCalledTimes(1);
    expect(container.llm).toHaveBeenCalledWith("openai");
  });
});
