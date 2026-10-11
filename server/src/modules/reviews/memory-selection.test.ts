import { describe, it, expect, vi } from "vitest";
import type { Embedder } from "@devdigest/shared";
import {
  MEMORY_TOP_K,
  buildMemoryQuery,
  selectMemoryForRun,
  type MemoryCandidate,
  type MemoryPicker,
} from "./memory-selection.js";

const entry = (id: string, hasEmbedding = true): MemoryCandidate => ({
  id,
  content: `content ${id}`,
  hasEmbedding,
});

function harness(opts: {
  eligible?: MemoryCandidate[] | Error;
  ranked?: { id: string; content: string; similarity: number }[] | Error;
  embedder?: "ok" | "throws" | "empty";
}) {
  const embed = vi.fn(async () => {
    if (opts.embedder === "throws") throw new Error("Embeddings are disabled");
    if (opts.embedder === "empty") return [[]];
    return [[0.1, 0.2, 0.3]];
  });
  const embedder: Embedder = { dims: 3, embed };
  const getEmbedder = vi.fn(async () => embedder);
  const picker: MemoryPicker = {
    listEligibleForPrompt: vi.fn(async () => {
      if (opts.eligible instanceof Error) throw opts.eligible;
      return opts.eligible ?? [];
    }),
    rankByEmbedding: vi.fn(async () => {
      if (opts.ranked instanceof Error) throw opts.ranked;
      return opts.ranked ?? [];
    }),
  };
  const log = vi.fn();
  const run = () =>
    selectMemoryForRun({ picker, getEmbedder, log }, { workspaceId: "ws", repoId: "repo", queryText: "Q" });
  return { run, picker, embed, getEmbedder, log };
}

describe("selectMemoryForRun", () => {
  it("ranks the eligible entries by similarity and returns the top K with rank and similarity", async () => {
    const eligible = Array.from({ length: 8 }, (_, i) => entry(`m${i}`));
    const ranked = Array.from({ length: MEMORY_TOP_K }, (_, i) => ({
      id: `m${7 - i}`,
      content: `content m${7 - i}`,
      similarity: 0.9 - i * 0.1,
    }));
    const h = harness({ eligible, ranked });
    const out = await h.run();
    expect(out.mode).toBe("top_k");
    expect(out.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(out.entries.map((e) => e.id)).toEqual(["m7", "m6", "m5", "m4", "m3"]);
    expect(out.entries[0]!.similarity).toBeCloseTo(0.9, 9);
    expect(h.picker.rankByEmbedding).toHaveBeenCalledWith("ws", "repo", [0.1, 0.2, 0.3], MEMORY_TOP_K);
    expect(h.embed).toHaveBeenCalledWith(["Q"]);
  });

  it("with no eligible entries it is still a top_k run and does NOT call the embedder", async () => {
    const h = harness({ eligible: [] });
    expect(await h.run()).toEqual({ mode: "top_k", entries: [] });
    expect(h.getEmbedder).not.toHaveBeenCalled();
    expect(h.embed).not.toHaveBeenCalled();
  });

  it("falls back to every eligible entry when none has an embedding, without calling the embedder", async () => {
    const h = harness({ eligible: [entry("a", false), entry("b", false)] });
    const out = await h.run();
    expect(out.mode).toBe("fallback");
    expect(out.entries).toEqual([
      { id: "a", content: "content a", rank: 1, similarity: null },
      { id: "b", content: "content b", rank: 2, similarity: null },
    ]);
    expect(h.embed).not.toHaveBeenCalled();
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining("no eligible entry has an embedding"));
  });

  it("falls back, and says why in the run log, when the embedder is unavailable", async () => {
    const h = harness({ eligible: [entry("a")], embedder: "throws" });
    const out = await h.run();
    expect(out.mode).toBe("fallback");
    expect(out.entries).toHaveLength(1);
    expect(h.log).toHaveBeenCalledWith(expect.stringMatching(/embedder unavailable.*Embeddings are disabled/));
  });

  it("falls back when the embedder returns an empty vector", async () => {
    const h = harness({ eligible: [entry("a")], embedder: "empty" });
    expect((await h.run()).mode).toBe("fallback");
  });

  it("falls back when the similarity query fails", async () => {
    const h = harness({ eligible: [entry("a")], ranked: new Error("pgvector missing") });
    const out = await h.run();
    expect(out.mode).toBe("fallback");
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining("similarity search failed"));
  });

  it("never throws: a failing eligibility query yields an empty fallback", async () => {
    const h = harness({ eligible: new Error("db down") });
    await expect(h.run()).resolves.toEqual({ mode: "fallback", entries: [] });
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining("could not list entries"));
  });

  it("entries without an embedding are not the picker's concern: top-K only ranks what the DB returns", async () => {
    const h = harness({ eligible: [entry("with"), entry("without", false)], ranked: [{ id: "with", content: "content with", similarity: 0.7 }] });
    const out = await h.run();
    expect(out.entries.map((e) => e.id)).toEqual(["with"]);
  });
});

describe("buildMemoryQuery", () => {
  it("joins intent, title and changed files, skipping empty parts", () => {
    expect(buildMemoryQuery({ intent: "Adds retry", title: "Webhook retry", changedFiles: ["a.ts", "b.ts"] })).toBe(
      "Adds retry\n\nWebhook retry\n\na.ts\nb.ts",
    );
    expect(buildMemoryQuery({ title: "T", changedFiles: [] })).toBe("T");
    expect(buildMemoryQuery({ intent: "   ", title: "T", changedFiles: ["x"] })).toBe("T\n\nx");
  });

  it("is capped so an enormous PR cannot blow up the embedding call", () => {
    const q = buildMemoryQuery({ title: "T", changedFiles: Array.from({ length: 5000 }, (_, i) => `file-${i}.ts`) });
    expect(q.length).toBeLessThanOrEqual(6000);
  });
});
