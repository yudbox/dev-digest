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

vi.mock("./intent-deriver.js", () => ({
  deriveIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@devdigest/reviewer-core", () => ({
  reviewPullRequest: vi.fn().mockResolvedValue({
    review: { verdict: "approve", summary: "Looks good", score: 100, findings: [] },
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.001,
    costSource: "estimate",
    skillsApplied: null,
    grounding: "0/0 passed",
    assembly: {},
    chunks: [],
    mode: "single-pass",
    raw: "{}",
  }),
  countBlockers: vi.fn().mockReturnValue(0),
  // Real labels: the executor maps the model's S1…Sn back to skill ids with this.
  skillLabel: (i: number) => `S${i + 1}`,
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
    // Embeddings are off in this harness (the container throws) → memory falls back.
    embedder: vi.fn().mockRejectedValue(new Error("Embeddings are disabled")),
    memoryRepo: {
      listEligibleForPrompt: vi.fn().mockResolvedValue([]),
      rankByEmbedding: vi.fn().mockResolvedValue([]),
      touchLastUsed: vi.fn().mockResolvedValue(undefined),
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
    setMemorySelection: vi.fn().mockResolvedValue(undefined),
    insertRunSkills: vi.fn().mockResolvedValue(undefined),
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

describe("ReviewRunExecutor — Intent context loader (SPEC-2026-09-23-smart-diff-hw3-upgrade)", () => {
  it("passes a loadContext loader (not a pre-fetched linkedIssue) to deriveIntent", async () => {
    const { deriveIntent } = await import("./intent-deriver.js");
    const container = makeContainer({ hasOverride: false });
    const repo = makeRepo();
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

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

    await executor.executeRuns("ws-1", pull, repoRow, [
      { agent: makeAgent(), runId: "run-1" },
    ]);

    expect(deriveIntent).toHaveBeenCalled();
    const lastCall = (deriveIntent as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    const loadContext = lastCall[6];
    expect(typeof loadContext).toBe("function");
    // Calling it must not throw (no issue/plan link in this pull's body → a
    // no-op gather, no vcs/git calls needed).
    await expect(loadContext()).resolves.toEqual(
      expect.objectContaining({ missing: {} }),
    );
  });
});

describe("ReviewRunExecutor — run records (cost source, skills, memory)", () => {
  const pull = {
    id: "pr-1",
    repoId: "repo-1",
    number: 1,
    title: "Add retry to webhook sender",
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
  } as unknown as Parameters<InstanceType<typeof ReviewRunExecutor>["executeRuns"]>[2];

  const skill = (id: string, version: number, enabled = true) => ({
    skill: { id, version, enabled, source: "manual", body: `body-${id}`, contextDocPaths: [] },
  });
  const finding = (id: string, rule_refs?: string[]) => ({
    id,
    severity: "WARNING",
    category: "security",
    title: id,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    confidence: 0.9,
    ...(rule_refs ? { rule_refs } : {}),
  });

  async function run(opts: {
    skills?: ReturnType<typeof skill>[];
    outcome?: Record<string, unknown>;
    memory?: { eligible: unknown[]; embedderFails?: boolean };
  }) {
    const { reviewPullRequest } = await import("@devdigest/reviewer-core");
    const container = makeContainer({ hasOverride: false }) as unknown as Record<string, any>;
    container.agentsRepo.linkedSkills.mockResolvedValue(opts.skills ?? []);
    if (opts.memory) {
      container.memoryRepo.listEligibleForPrompt.mockResolvedValue(opts.memory.eligible);
    }
    if (opts.outcome) {
      (reviewPullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        review: { verdict: "comment", summary: "s", score: 90, findings: [] },
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.01,
        costSource: "api",
        skillsApplied: null,
        grounding: "1/1 passed",
        assembly: {},
        chunks: [],
        mode: "single-pass",
        raw: "{}",
        ...opts.outcome,
      });
    }
    const repo = makeRepo();
    const executor = new ReviewRunExecutor(container as unknown as Container, repo, container.agentsRepo);
    await executor.executeRuns("ws-1", pull, repoRow, [{ agent: makeAgent(), runId: "run-1" }]);
    return { repo, container };
  }

  it("persists the cost source the engine reported", async () => {
    const { repo } = await run({ outcome: { costSource: "api" } });
    expect(repo.completeAgentRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "done", costSource: "api" }),
    );
  });

  it("records every loaded skill with applied flag and how many saved findings cite it", async () => {
    const skills = [skill("sk-1", 3), skill("sk-2", 1), skill("sk-3", 2)];
    const { repo } = await run({
      skills,
      outcome: {
        skillsApplied: ["S1", "S9"], // S9 does not exist → dropped
        review: {
          verdict: "comment",
          summary: "s",
          score: 80,
          findings: [finding("f1", ["S1"]), finding("f2", ["S1", "S3"]), finding("f3")],
        },
      },
    });
    expect(repo.insertRunSkills).toHaveBeenCalledWith("run-1", [
      { skillId: "sk-1", skillVersion: 3, applied: true, findingsCited: 2 },
      { skillId: "sk-2", skillVersion: 1, applied: false, findingsCited: 0 },
      { skillId: "sk-3", skillVersion: 2, applied: false, findingsCited: 1 },
    ]);
    // findings are saved with skill IDS (never labels); a finding citing nothing has null
    expect(repo.insertFindings).toHaveBeenCalledWith("review-1", expect.any(Array), [
      ["sk-1"],
      ["sk-1", "sk-3"],
      null,
    ]);
  });

  it("only labels ENABLED skills, in the order they were given to the prompt", async () => {
    const { repo } = await run({
      skills: [skill("sk-off", 1, false), skill("sk-a", 1), skill("sk-b", 1)],
      outcome: { skillsApplied: ["S2"] }, // S1 = sk-a, S2 = sk-b (the disabled one is skipped)
    });
    expect(repo.insertRunSkills).toHaveBeenCalledWith("run-1", [
      { skillId: "sk-a", skillVersion: 1, applied: false, findingsCited: 0 },
      { skillId: "sk-b", skillVersion: 1, applied: true, findingsCited: 0 },
    ]);
  });

  it("with no skills loaded, records none", async () => {
    const { repo } = await run({});
    expect(repo.insertRunSkills).toHaveBeenCalledWith("run-1", []);
  });

  it("records the memory mode — fallback with the eligible entries when embeddings are off", async () => {
    const { repo } = await run({
      memory: { eligible: [{ id: "m1", content: "rule one", hasEmbedding: true }] },
    });
    expect(repo.setMemorySelection).toHaveBeenCalledWith("run-1", "fallback", [
      { id: "m1", content: "rule one", rank: 1, similarity: null },
    ]);
  });

  it("records mode top_k with no entries when there is no memory at all", async () => {
    const { repo } = await run({});
    expect(repo.setMemorySelection).toHaveBeenCalledWith("run-1", "top_k", []);
  });

  it("a failure while recording usage never fails the review", async () => {
    const { reviewPullRequest } = await import("@devdigest/reviewer-core");
    void reviewPullRequest;
    const container = makeContainer({ hasOverride: false }) as unknown as Record<string, any>;
    const repo = makeRepo();
    (repo.insertRunSkills as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    (repo.setMemorySelection as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    const executor = new ReviewRunExecutor(container as unknown as Container, repo, container.agentsRepo);
    await executor.executeRuns("ws-1", pull, repoRow, [{ agent: makeAgent(), runId: "run-1" }]);
    expect(repo.completeAgentRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "done" }));
  });
});
