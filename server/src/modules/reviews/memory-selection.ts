import type { Embedder } from "@devdigest/shared";

/**
 * Which memory entries go into a review prompt, and how that was decided.
 *
 *  - top_k    : the K eligible entries closest in meaning to the PR (embedding
 *               similarity). Different PRs pull different memory, so "how often
 *               was this entry pulled" is a real signal.
 *  - fallback : the deterministic selection used before this feature (every
 *               eligible entry). Used when similarity search is not possible.
 *
 * Never throws and never fails a review: memory is an enhancement.
 */

export const MEMORY_TOP_K = 5;
/** Characters of PR context sent to the embedder (keeps the call cheap and bounded). */
const MAX_QUERY_CHARS = 6000;

export interface MemoryCandidate {
  id: string;
  content: string;
  hasEmbedding: boolean;
}

export interface MemoryPicker {
  listEligibleForPrompt(workspaceId: string, repoId: string): Promise<MemoryCandidate[]>;
  rankByEmbedding(
    workspaceId: string,
    repoId: string,
    vector: number[],
    k: number,
  ): Promise<{ id: string; content: string; similarity: number }[]>;
}

export interface SelectedMemory {
  id: string;
  content: string;
  /** 1 = most similar (top_k) or list order (fallback). */
  rank: number;
  /** Cosine similarity; null for the fallback selection. */
  similarity: number | null;
}

export interface MemorySelection {
  mode: "top_k" | "fallback";
  entries: SelectedMemory[];
}

export interface MemorySelectionDeps {
  picker: MemoryPicker;
  getEmbedder: () => Promise<Embedder>;
  /** Run-log sink (the reason for a fallback is recorded here). */
  log: (message: string) => void;
}

/**
 * Query text for the embedder: the PR's derived intent, its title and the list
 * of changed files. Empty parts are skipped.
 */
export function buildMemoryQuery(parts: {
  intent?: string;
  title: string;
  changedFiles: string[];
}): string {
  return [parts.intent, parts.title, parts.changedFiles.join("\n")]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join("\n\n")
    .slice(0, MAX_QUERY_CHARS);
}

export async function selectMemoryForRun(
  deps: MemorySelectionDeps,
  args: { workspaceId: string; repoId: string; queryText: string },
): Promise<MemorySelection> {
  const { picker, getEmbedder, log } = deps;

  let eligible: MemoryCandidate[];
  try {
    eligible = await picker.listEligibleForPrompt(args.workspaceId, args.repoId);
  } catch (err) {
    log(`Memory: could not list entries (${(err as Error).message}) — continuing without memory`);
    return { mode: "fallback", entries: [] };
  }

  const fallback = (reason: string): MemorySelection => {
    log(`Memory: ${reason} — using all ${eligible.length} eligible rule(s)`);
    return {
      mode: "fallback",
      entries: eligible.map((e, i) => ({ id: e.id, content: e.content, rank: i + 1, similarity: null })),
    };
  };

  // Nothing to pick from: still a top-K run (the mode is recorded), no embedder call.
  if (eligible.length === 0) return { mode: "top_k", entries: [] };

  // Entries without an embedding cannot be ranked, so they are not eligible for
  // top-K. If NONE can be ranked, similarity search is pointless.
  if (!eligible.some((e) => e.hasEmbedding)) {
    return fallback("no eligible entry has an embedding");
  }

  let vector: number[];
  try {
    const embedder = await getEmbedder();
    const [v] = await embedder.embed([args.queryText]);
    if (!v || v.length === 0) return fallback("embedder returned no vector");
    vector = v;
  } catch (err) {
    return fallback(`embedder unavailable (${(err as Error).message})`);
  }

  try {
    const ranked = await picker.rankByEmbedding(args.workspaceId, args.repoId, vector, MEMORY_TOP_K);
    const entries = ranked.map((r, i) => ({
      id: r.id,
      content: r.content,
      rank: i + 1,
      similarity: r.similarity,
    }));
    log(`Memory: ${entries.length} of ${eligible.length} rule(s) selected by relevance`);
    return { mode: "top_k", entries };
  } catch (err) {
    return fallback(`similarity search failed (${(err as Error).message})`);
  }
}
