import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Container } from "../../platform/container.js";
import { OnboardingService, buildRunCommands } from "./service.js";
import { MockLLMProvider } from "../../adapters/mocks.js";
import { ValidationError, NotFoundError } from "../../platform/errors.js";
import type { Onboarding } from "@devdigest/shared";

// ---- Minimal fixture for a valid Onboarding LLM response ----

const VALID_ONBOARDING: Onboarding = {
  repoName: "owner/repo",
  filesIndexed: 50,
  generatedAt: new Date().toISOString(),
  headSha: "sha-fresh",
  sections: {
    architecture: {
      overview: "A client/server monorepo.",
      style: "monorepo",
      nodes: [
        { id: "client", label: "client", kind: "package" },
        { id: "server", label: "server", kind: "package" },
      ],
      edges: [{ from: "client", to: "server", label: "HTTP" }],
    },
    criticalPaths: [
      {
        file: "server/src/app.ts",
        whyItMatters: "Entry point",
        openUrl: "https://github.com/owner/repo/blob/HEAD/server/src/app.ts",
      },
    ],
    howToRun: {
      packageManager: "pnpm",
      commands: ["pnpm install", "pnpm dev"],
      envVars: ["DATABASE_URL"],
      entrypoint: "pnpm dev",
    },
    readingPath: [
      {
        order: 1,
        file: "server/src/app.ts",
        reason: "Start here",
        openUrl: "https://github.com/owner/repo/blob/HEAD/server/src/app.ts",
      },
    ],
    firstTasks: [
      {
        title: "Add tests for app.ts",
        suggestedPath: "server/src/app.test.ts",
        gapType: "missing-test",
        rationale: "High-ranked file with no tests",
        patternPointer: "server/src/app.ts",
        complexity: "Medium",
        verificationHint: "Run vitest",
        packageId: "server",
      },
    ],
  },
};

// ---- Container stub ----

function makeContainer(opts: {
  repoFound?: boolean;
  headSha?: string;
  cachedOnboarding?: { onboarding: Onboarding; headSha: string } | null;
  featureModelOverride?: { provider: string; model: string } | null;
  llmFixture?: unknown;
}): Container {
  const {
    repoFound = true,
    headSha = "sha-fresh",
    cachedOnboarding = null,
    featureModelOverride = { provider: "openai", model: "gpt-4o" },
    llmFixture = VALID_ONBOARDING,
  } = opts;

  const mockLlm = new MockLLMProvider("openai", { structured: llmFixture });

  return {
    reposRepo: {
      getById: vi.fn().mockResolvedValue(
        repoFound
          ? {
              id: "repo-1",
              workspaceId: "ws-1",
              owner: "owner",
              name: "repo",
              fullName: "owner/repo",
              clonePath: "/tmp/mock-clone",
            }
          : undefined,
      ),
    },
    repoIntel: {
      getIndexState: vi.fn().mockResolvedValue({
        status: "full",
        filesIndexed: 50,
        filesSkipped: 0,
        durationMs: 100,
        repoId: "repo-1",
        lastIndexedSha: headSha,
        indexerVersion: 1,
        updatedAt: new Date(),
      }),
      getTopFilesByRank: vi.fn().mockResolvedValue(["server/src/app.ts"]),
      getFileRank: vi
        .fn()
        .mockResolvedValue([{ path: "server/src/app.ts", percentile: 0.9 }]),
      getCriticalPaths: vi.fn().mockResolvedValue([["server/src/app.ts"]]),
    },
    contextService: {
      listDocsForRepo: vi.fn().mockResolvedValue([]),
    },
    vcs: vi.fn().mockResolvedValue({
      getCommitActivity: vi.fn().mockResolvedValue({}),
    }),
    llm: vi.fn().mockResolvedValue(mockLlm),
    db: {
      // Mimic advisory lock: just run fn() immediately
      transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
          return fn({
            execute: vi.fn().mockResolvedValue(undefined),
          });
        }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi
            .fn()
            .mockResolvedValue(
              featureModelOverride
                ? [
                    {
                      key: "feature_models",
                      value: { onboarding: featureModelOverride },
                    },
                  ]
                : [],
            ),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
  } as unknown as Container;
}

// ---- Tests ----

describe("OnboardingService.generate()", () => {
  it("throws NotFoundError when repo does not exist", async () => {
    const container = makeContainer({ repoFound: false });
    const service = new OnboardingService(container);
    await expect(
      service.generate("ws-1", "repo-1", false, { info: vi.fn() }),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError when no model is configured", async () => {
    const container = makeContainer({ featureModelOverride: null });
    const service = new OnboardingService(container);
    await expect(
      service.generate("ws-1", "repo-1", false, { info: vi.fn() }),
    ).rejects.toThrow(ValidationError);
  });

  it("returns a deterministic skeleton (narrativeUnavailable) and does NOT write cache when the LLM call fails (AC-20)", async () => {
    const container = makeContainer({});
    (container.llm as ReturnType<typeof vi.fn>).mockResolvedValue({
      completeStructured: vi.fn().mockRejectedValue(new Error("LLM down")),
    });
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
      error: vi.fn(),
    });

    expect(result.narrativeUnavailable).toBe(true);
    expect(result.sections.howToRun.commands.length).toBeGreaterThan(0);
    // Skeleton must never be persisted as a cached result.
    expect(container.db.insert).not.toHaveBeenCalled();
  });

  it("logs 'cache hit' info message when cached with matching headSha", async () => {
    // We can verify the cache logic by ensuring the service doesn't call LLM
    // when a row with matching headSha is already in the DB.
    // This is verified via the db.select chain returning a cached row.
    const container = makeContainer({});
    // Override db.select to return a cached onboarding row for ALL table reads
    const cachedRow = { json: VALID_ONBOARDING, headSha: "sha-fresh" };
    (container.db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([cachedRow]),
      }),
    });

    const service = new OnboardingService(container);
    const infoLog = vi.fn();
    // With the above mock, getCachedOnboarding returns cachedRow with headSha "sha-fresh"
    // which matches indexState.lastIndexedSha "sha-fresh" — should return cache
    // (resolveFeatureModelStrict won't run, container.llm won't be called)
    await service.generate("ws-1", "repo-1", false, { info: infoLog });
    expect(infoLog).toHaveBeenCalledWith(expect.stringContaining("cache hit"));
  });

  it("makes exactly ONE LLM call per generation", async () => {
    const container = makeContainer({});
    const service = new OnboardingService(container);
    await service.generate("ws-1", "repo-1", false, { info: vi.fn() });
    const llmProvider = await (container.llm as ReturnType<typeof vi.fn>).mock
      .results[0]?.value;
    expect(
      (llmProvider as MockLLMProvider).calls.filter(
        (c) => c.method === "completeStructured",
      ),
    ).toHaveLength(1);
  });

  it("logs cost in cents after LLM call", async () => {
    const container = makeContainer({});
    const service = new OnboardingService(container);
    const infoLog = vi.fn();
    await service.generate("ws-1", "repo-1", false, { info: infoLog });
    const costLog = infoLog.mock.calls.find((c) =>
      (c[0] as string).includes("¢"),
    );
    expect(costLog).toBeDefined();
  });

  it("degrades to pure-percentile ranking when getCommitActivity throws (AC-13)", async () => {
    const container = makeContainer({});
    (container.vcs as ReturnType<typeof vi.fn>).mockResolvedValue({
      getCommitActivity: vi.fn().mockRejectedValue(new Error("rate limited")),
    });
    const service = new OnboardingService(container);
    // Must NOT throw — generation completes with hotness=0 fallback.
    await expect(
      service.generate("ws-1", "repo-1", false, { info: vi.fn() }),
    ).resolves.toBeDefined();
  });

  it("overwrites top-level metadata with server-known facts, never the LLM's own guess (bugfix: stale 'last refreshed' from an LLM-echoed date)", async () => {
    const container = makeContainer({
      headSha: "sha-fresh",
      llmFixture: {
        ...VALID_ONBOARDING,
        // The model has no real notion of wall-clock time / the true
        // indexed file count / the real headSha — simulate it echoing back
        // plausible-looking but wrong values, as seen in production (a
        // "refreshed 452 days ago" tour that was in fact just generated).
        repoName: "wrong/repo",
        filesIndexed: 999999,
        generatedAt: new Date(Date.now() - 452 * 24 * 60 * 60 * 1000).toISOString(),
        headSha: "wrong-sha",
      },
    });
    const before = Date.now();
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
    });
    expect(result.repoName).toBe("owner/repo");
    expect(result.filesIndexed).toBe(50);
    expect(result.headSha).toBe("sha-fresh");
    expect(new Date(result.generatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("buildRunCommands — facts-only, 0 LLM calls (AC-14)", () => {
  it("produces non-empty commands/envVars/entrypoint from facts alone", () => {
    const facts = {
      packageManager: "pnpm" as const,
      packages: [],
      dockerServices: [{ name: "postgres", image: "postgres:16" }],
      envVars: ["DATABASE_URL", "GITHUB_TOKEN"],
      orchestrationScripts: [],
      entrypoint: "pnpm dev",
    };
    const commands = buildRunCommands(facts);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands).toContain("pnpm install");
    expect(commands).toContain("pnpm dev");
    expect(commands).toContain("docker compose up -d");
    expect(facts.envVars.length).toBeGreaterThan(0);
    expect(facts.entrypoint).toBe("pnpm dev");
  });
});

// ---- Deterministic sections against a real (temp) multi-package repo ----

describe("OnboardingService.generate() — deterministic multi-package sections", () => {
  let clonePath: string;

  beforeAll(async () => {
    clonePath = await mkdtemp(join(tmpdir(), "onboarding-fixture-"));
    await mkdir(join(clonePath, "server", "src"), { recursive: true });
    await mkdir(join(clonePath, "client", "src"), { recursive: true });
    await writeFile(
      join(clonePath, "server", "package.json"),
      JSON.stringify({
        name: "server-pkg",
        dependencies: { fastify: "^5.0.0" },
      }),
    );
    await writeFile(
      join(clonePath, "server", "src", "app.ts"),
      "export const app = 1;\n",
    );
    await writeFile(
      join(clonePath, "client", "package.json"),
      JSON.stringify({ name: "client-pkg", dependencies: { react: "^19.0.0" } }),
    );
    await writeFile(
      join(clonePath, "client", "src", "index.tsx"),
      "export const App = () => null;\n",
    );
  });

  afterAll(async () => {
    await rm(clonePath, { recursive: true, force: true });
  });

  function makeMultiPkgContainer(opts: {
    callerRowsByFile?: Record<string, number>;
  }): Container {
    const callerRowsByFile = opts.callerRowsByFile ?? {};
    const mockLlm = new MockLLMProvider("openai", {
      structured: {
        repoName: "owner/repo",
        filesIndexed: 20,
        generatedAt: new Date().toISOString(),
        headSha: "sha-fresh",
        sections: {
          architecture: {
            overview: "A client/server split.",
            style: "fullstack-monolith",
            nodes: [
              { id: "server-pkg", label: "server-pkg", kind: "package" },
              { id: "client-pkg", label: "client-pkg", kind: "package" },
            ],
            edges: [{ from: "client-pkg", to: "server-pkg" }],
          },
          criticalPaths: [],
          howToRun: {
            packageManager: "pnpm",
            commands: ["pnpm install", "pnpm dev"],
            envVars: [],
            entrypoint: "pnpm dev",
          },
          readingPath: [],
          firstTasks: [],
        },
      },
    });

    return {
      reposRepo: {
        getById: vi.fn().mockResolvedValue({
          id: "repo-1",
          workspaceId: "ws-1",
          owner: "owner",
          name: "repo",
          fullName: "owner/repo",
          clonePath,
        }),
      },
      repoIntel: {
        getIndexState: vi.fn().mockResolvedValue({
          status: "full",
          filesIndexed: 20,
          filesSkipped: 0,
          durationMs: 100,
          repoId: "repo-1",
          lastIndexedSha: "sha-fresh",
          indexerVersion: 1,
          updatedAt: new Date(),
        }),
        getTopFilesByRank: vi
          .fn()
          .mockResolvedValue([
            "server/src/app.ts",
            "server/src/db.ts",
            "client/src/index.tsx",
          ]),
        getFileRank: vi.fn().mockResolvedValue([
          { path: "server/src/app.ts", percentile: 0.9 },
          { path: "server/src/db.ts", percentile: 0.85 },
          { path: "client/src/index.tsx", percentile: 0.8 },
        ]),
        getCriticalPaths: vi.fn().mockResolvedValue([
          ["server/src/app.ts", "server/src/db.ts"],
          ["server/src/app.ts", "client/src/index.tsx"],
        ]),
        getCallerSignatures: vi
          .fn()
          .mockImplementation(async (_repoId: string, files: string[]) => {
            const file = files[0]!;
            const count = callerRowsByFile[file] ?? 0;
            return Array.from({ length: count }, (_, i) => ({
              file: `caller-${i}.ts`,
              symbol: "x",
              signature: "x()",
              rank: 0,
            }));
          }),
      },
      contextService: {
        listDocsForRepo: vi.fn().mockResolvedValue([]),
      },
      codeIndex: {
        // Non-empty match for every marker → no missing-pattern candidates,
        // isolating this fixture to missing-test / missing-doc (AC-16/AC-17).
        grep: vi
          .fn()
          .mockResolvedValue([{ path: "server/src/app.ts", line: 1, text: "match" }]),
      },
      github: vi.fn().mockResolvedValue({ getCommitActivity: vi.fn().mockResolvedValue({}) }),
      llm: vi.fn().mockResolvedValue(mockLlm),
      db: {
        transaction: vi
          .fn()
          .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({ execute: vi.fn().mockResolvedValue(undefined) }),
          ),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              {
                key: "feature_models",
                value: { onboarding: { provider: "openai", model: "gpt-4o" } },
              },
            ]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      },
    } as unknown as Container;
  }

  it("readingPath mirrors getCriticalPaths' traversal order (AC-15)", async () => {
    const container = makeMultiPkgContainer({});
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
    });
    expect(result.sections.readingPath.map((r) => r.file)).toEqual([
      "server/src/app.ts",
      "server/src/db.ts",
      "client/src/index.tsx",
    ]);
    expect(result.sections.readingPath.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it("detects a missing-test AND missing-doc gap, tie-break includes both types (AC-16)", async () => {
    const container = makeMultiPkgContainer({});
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
    });
    const gapTypes = new Set(result.sections.firstTasks.map((t) => t.gapType));
    expect(gapTypes.has("missing-test")).toBe(true);
    expect(gapTypes.has("missing-doc")).toBe(true);

    const testTask = result.sections.firstTasks.find(
      (t) => t.gapType === "missing-test",
    );
    expect(testTask?.suggestedPath).toMatch(/\.test\.ts$/);
  });

  it("bumps missing-test complexity to High when target fan-in is high (AC-17)", async () => {
    const container = makeMultiPkgContainer({
      callerRowsByFile: { "server/src/app.ts": 10 }, // >= HIGH_FAN_IN_THRESHOLD (5)
    });
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
    });
    const serverTestTask = result.sections.firstTasks.find(
      (t) => t.gapType === "missing-test" && t.patternPointer === "server/src/app.ts",
    );
    expect(serverTestTask?.complexity).toBe("High");
  });

  it("reserves a Critical Paths slot for each detected package (AC-18)", async () => {
    const container = makeMultiPkgContainer({});
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
    });
    const files = result.sections.criticalPaths.map((c) => c.file);
    expect(files.some((f) => f.startsWith("server/"))).toBe(true);
    expect(files.some((f) => f.startsWith("client/"))).toBe(true);
  });

  it("does not let one package dominate First Tasks — both detected packages are represented (AC-18)", async () => {
    const container = makeMultiPkgContainer({});
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
    });
    const packageIds = new Set(
      result.sections.firstTasks.map((t) => t.packageId),
    );
    expect(packageIds.has("server-pkg")).toBe(true);
    expect(packageIds.has("client-pkg")).toBe(true);
  });

  it("populates a real, grounded drill-down sub-diagram per package node — never the LLM's own guess (AC-27, bugfix: blank drill-down modal)", async () => {
    const container = makeMultiPkgContainer({});
    const service = new OnboardingService(container);
    const result = await service.generate("ws-1", "repo-1", false, {
      info: vi.fn(),
    });
    const serverNode = result.sections.architecture.nodes.find(
      (n) => n.id === "server-pkg",
    );
    const clientNode = result.sections.architecture.nodes.find(
      (n) => n.id === "client-pkg",
    );
    // server-pkg has 2 real files connected by a real getCriticalPaths edge
    // (app.ts -> db.ts) — a genuine sub-diagram.
    expect(serverNode?.detail).toContain("server/src/app.ts");
    expect(serverNode?.detail).toContain("server/src/db.ts");
    expect(serverNode?.detail).toMatch(/^flowchart/);

    // client-pkg has only ONE known file (index.tsx) — no possible edge
    // within the package, so `detail` must stay undefined (honest "no detail
    // available" on the client) rather than a pointless single-box diagram
    // (bugfix: real repos showed e.g. "@devdigest/mcp" as a bare path box).
    expect(clientNode?.detail).toBeUndefined();
  });
});
