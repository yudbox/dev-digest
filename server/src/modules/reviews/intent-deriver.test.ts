import { describe, it, expect, vi } from "vitest";
import type { Container } from "../../platform/container.js";
import type { ReviewRepository, PullRow } from "./repository.js";
import type { UnifiedDiff } from "@devdigest/shared";
import { RunLogger } from "../../platform/run-logger.js";
import { RunBus } from "../../platform/sse.js";
import { deriveIntent } from "./intent-deriver.js";
import type { IntentContext } from "./intent-context.js";

/**
 * AC-024: intent-deriver runs inside the background review pipeline (not an
 * HTTP handler) — a missing feature-model override must degrade (skip intent
 * derivation, log, continue) rather than crash the whole review run. This is
 * a deliberate, documented deviation from AC-14's literal "throw 422" wording,
 * scoped to this call site only.
 */

function makeContainer(opts: { hasOverride: boolean }): Container {
  return {
    llm: vi.fn().mockResolvedValue({
      completeStructured: vi.fn(),
    }),
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(
            opts.hasOverride
              ? [
                  {
                    key: "feature_models",
                    value: {
                      review_intent: { provider: "openai", model: "gpt-4.1" },
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
  } as unknown as ReviewRepository;
}

function makePull(): PullRow {
  return {
    id: "pr-1",
    repoId: "repo-1",
    number: 42,
    title: "Add feature X",
    body: null,
    headSha: "sha-1",
    lastReviewedSha: null,
  } as unknown as PullRow;
}

function makeDiff(): UnifiedDiff {
  return {
    files: [
      {
        path: "src/a.ts",
        additions: 1,
        deletions: 0,
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 }],
      },
    ],
    raw: "diff --git a/src/a.ts b/src/a.ts",
  } as unknown as UnifiedDiff;
}

describe("deriveIntent — feature-model strict resolution degrade (AC-024)", () => {
  it("returns undefined (does not throw) when no workspace override is configured", async () => {
    const container = makeContainer({ hasOverride: false });
    const repo = makeRepo();
    const runLog = new RunLogger(new RunBus(), ["run-1"]);

    const result = await deriveIntent(
      container,
      repo,
      "ws-1",
      makePull(),
      makeDiff(),
      runLog,
    );

    expect(result).toBeUndefined();
    // Never reaches the LLM call — resolveFeatureModelStrict throws before it.
    expect(container.llm).not.toHaveBeenCalled();
  });

  it("proceeds to call the LLM when a workspace override IS configured", async () => {
    const container = makeContainer({ hasOverride: true });
    const repo = makeRepo();
    const runLog = new RunLogger(new RunBus(), ["run-1"]);
    (container.llm as ReturnType<typeof vi.fn>).mockResolvedValue({
      completeStructured: vi.fn().mockResolvedValue({
        data: { intent: "Adds feature X", in_scope: ["src/a.ts"], out_of_scope: [] },
      }),
    });

    const result = await deriveIntent(
      container,
      repo,
      "ws-1",
      makePull(),
      makeDiff(),
      runLog,
    );

    expect(container.llm).toHaveBeenCalledWith("openai");
    expect(result).toContain("Adds feature X");
  });
});

// ── SPEC-2026-09-23-smart-diff-hw3-upgrade (AC-39..44) ──────────────────────

function makeStructuredLlm() {
  return {
    completeStructured: vi.fn().mockResolvedValue({
      data: { intent: "Adds feature X", in_scope: ["src/a.ts"], out_of_scope: [] },
    }),
  };
}

describe("deriveIntent — model log, untrusted context, missing-context note", () => {
  it("AC-39: logs the provider and model before the LLM call", async () => {
    const container = makeContainer({ hasOverride: true });
    (container.llm as ReturnType<typeof vi.fn>).mockResolvedValue(makeStructuredLlm());
    const repo = makeRepo();
    const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const runLog = new RunLogger(new RunBus(), ["run-1"], base);

    await deriveIntent(container, repo, "ws-1", makePull(), makeDiff(), runLog);

    const infoMessages = base.info.mock.calls.map((c) => c[1]);
    expect(infoMessages).toContainEqual("Intent: calling openai/gpt-4.1");
  });

  it("AC-40: wraps the linked issue body as untrusted, truncated to ISSUE_BODY_MAX_CHARS", async () => {
    const container = makeContainer({ hasOverride: true });
    const llm = makeStructuredLlm();
    (container.llm as ReturnType<typeof vi.fn>).mockResolvedValue(llm);
    const repo = makeRepo();
    const runLog = new RunLogger(new RunBus(), ["run-1"]);
    const longBody = "x".repeat(5000);

    const loadContext = vi.fn().mockResolvedValue({
      issue: { number: 42, title: "Do the thing", body: longBody, state: "open" },
      missing: {},
    } satisfies IntentContext);

    await deriveIntent(
      container,
      repo,
      "ws-1",
      makePull(),
      makeDiff(),
      runLog,
      loadContext,
    );

    const userMessage = llm.completeStructured.mock.calls[0]![0].messages[1].content as string;
    expect(userMessage).toContain('<untrusted source="issue:#42">');
    const wrapped = userMessage.match(/<untrusted source="issue:#42">\n([\s\S]*?)\n<\/untrusted>/)![1]!;
    expect(wrapped.length).toBeLessThanOrEqual(1000);
  });

  it("AC-41: wraps the plan content as untrusted, truncated to PLAN_MAX_CHARS", async () => {
    const container = makeContainer({ hasOverride: true });
    const llm = makeStructuredLlm();
    (container.llm as ReturnType<typeof vi.fn>).mockResolvedValue(llm);
    const repo = makeRepo();
    const runLog = new RunLogger(new RunBus(), ["run-1"]);
    const longPlan = "y".repeat(5000);

    const loadContext = vi.fn().mockResolvedValue({
      plan: { path: "specs/PLAN-x.md", content: longPlan },
      missing: {},
    } satisfies IntentContext);

    await deriveIntent(
      container,
      repo,
      "ws-1",
      makePull(),
      makeDiff(),
      runLog,
      loadContext,
    );

    const userMessage = llm.completeStructured.mock.calls[0]![0].messages[1].content as string;
    expect(userMessage).toContain('<untrusted source="plan:specs/PLAN-x.md">');
    const wrapped = userMessage.match(
      /<untrusted source="plan:specs\/PLAN-x\.md">\n([\s\S]*?)\n<\/untrusted>/,
    )![1]!;
    expect(wrapped.length).toBeLessThanOrEqual(2000);
  });

  it("AC-43: missing issue context → saved intent contains a note mentioning #N", async () => {
    const container = makeContainer({ hasOverride: true });
    (container.llm as ReturnType<typeof vi.fn>).mockResolvedValue(makeStructuredLlm());
    const repo = makeRepo();
    const runLog = new RunLogger(new RunBus(), ["run-1"]);

    const loadContext = vi.fn().mockResolvedValue({
      missing: { issueNumber: 42 },
    } satisfies IntentContext);

    await deriveIntent(container, repo, "ws-1", makePull(), makeDiff(), runLog, loadContext);

    const [, savedIntent] = (repo.upsertIntent as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(savedIntent.intent).toContain("#42");
  });

  it("AC-44: no missing context → no note added to the saved intent", async () => {
    const container = makeContainer({ hasOverride: true });
    (container.llm as ReturnType<typeof vi.fn>).mockResolvedValue(makeStructuredLlm());
    const repo = makeRepo();
    const runLog = new RunLogger(new RunBus(), ["run-1"]);

    const loadContext = vi.fn().mockResolvedValue({ missing: {} } satisfies IntentContext);

    await deriveIntent(container, repo, "ws-1", makePull(), makeDiff(), runLog, loadContext);

    const [, savedIntent] = (repo.upsertIntent as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(savedIntent.intent).not.toContain("Context incomplete");
  });

  it("cache hit → loadContext is never called", async () => {
    const container = makeContainer({ hasOverride: true });
    const repo = {
      getIntent: vi.fn().mockResolvedValue({
        intent: "Cached intent",
        in_scope: [],
        out_of_scope: [],
      }),
      upsertIntent: vi.fn(),
    } as unknown as ReviewRepository;
    const runLog = new RunLogger(new RunBus(), ["run-1"]);
    const loadContext = vi.fn();

    const pull = { ...makePull(), lastReviewedSha: "sha-1" } as PullRow;

    const result = await deriveIntent(
      container,
      repo,
      "ws-1",
      pull,
      makeDiff(),
      runLog,
      loadContext,
    );

    expect(loadContext).not.toHaveBeenCalled();
    expect(container.llm).not.toHaveBeenCalled();
    expect(result).toContain("Cached intent");
  });
});
