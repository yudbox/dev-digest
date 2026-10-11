import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";

/**
 * Integration-test fixtures for the performance module: build a clean workspace
 * with Drizzle inserts (no HTTP, no demo seed) so numbers are exact. Used only
 * by `*.it.test.ts`.
 */

export const NOW = new Date("2026-10-11T09:22:00Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** An instant `days` before NOW, nudged an hour off bucket boundaries. */
export const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY - HOUR);

export interface World {
  ws: string;
  repoId: string;
  prIds: string[];
}

export async function createWorld(db: Db, prCount = 3): Promise<World> {
  const [ws] = await db.insert(t.workspaces).values({ name: `perf-${Math.random()}` }).returning();
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId: ws!.id, owner: "acme", name: "perf", fullName: `acme/perf-${ws!.id}` })
    .returning();
  const prIds: string[] = [];
  for (let n = 1; n <= prCount; n++) {
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws!.id,
        repoId: repo!.id,
        number: n,
        title: `PR ${n}`,
        author: "dev",
        branch: "b",
        base: "main",
        headSha: `sha${n}`,
        status: "needs_review",
      })
      .returning();
    prIds.push(pr!.id);
  }
  return { ws: ws!.id, repoId: repo!.id, prIds };
}

export async function addAgent(
  db: Db,
  w: World,
  name: string,
  opts: { enabled?: boolean } = {},
): Promise<string> {
  const [a] = await db
    .insert(t.agents)
    .values({
      workspaceId: w.ws,
      repoId: w.repoId,
      name,
      provider: "openai",
      model: "m",
      systemPrompt: "s",
      enabled: opts.enabled ?? true,
    })
    .returning();
  return a!.id;
}

export interface RunSpec {
  agentId: string | null;
  ranAt: Date;
  status?: string;
  costUsd?: number | null;
  model?: string | null;
  durationMs?: number | null;
  costSource?: "api" | "estimate" | null;
  source?: "local" | "ci";
  ciRunId?: string | null;
  memoryMode?: "top_k" | "fallback" | null;
  prId?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  error?: string | null;
  findingsCount?: number | null;
}

export async function addRun(db: Db, w: World, s: RunSpec) {
  const [run] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: w.ws,
      agentId: s.agentId,
      prId: s.prId === undefined ? w.prIds[0]! : s.prId,
      ranAt: s.ranAt,
      status: s.status ?? "done",
      costUsd: s.costUsd === undefined ? null : s.costUsd,
      model: s.model === undefined ? "m1" : s.model,
      durationMs: s.durationMs === undefined ? null : s.durationMs,
      costSource: s.costSource ?? null,
      source: s.source ?? "local",
      ciRunId: s.ciRunId ?? null,
      memoryMode: s.memoryMode ?? null,
      tokensIn: s.tokensIn ?? null,
      tokensOut: s.tokensOut ?? null,
      error: s.error ?? null,
      findingsCount: s.findingsCount ?? null,
    })
    .returning();
  return run!;
}

export interface FindingSpec {
  severity?: "CRITICAL" | "WARNING" | "SUGGESTION";
  category?: "bug" | "security" | "perf" | "style" | "test";
  accepted?: boolean;
  dismissed?: boolean;
  ruleRefs?: string[];
}

/** A review (optionally linked to a run) with the given findings. */
export async function addReviewWithFindings(
  db: Db,
  w: World,
  opts: { agentId: string | null; runId: string | null; createdAt?: Date },
  findings: FindingSpec[],
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId: w.ws,
      prId: w.prIds[0]!,
      agentId: opts.agentId,
      runId: opts.runId,
      kind: "review",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  if (findings.length > 0) {
    await db.insert(t.findings).values(
      findings.map((f, i) => ({
        reviewId: review!.id,
        file: "a.ts",
        startLine: i + 1,
        endLine: i + 1,
        severity: f.severity ?? "WARNING",
        category: f.category ?? "bug",
        title: `finding ${i}`,
        rationale: "r",
        confidence: 0.9,
        acceptedAt: f.accepted ? new Date() : null,
        dismissedAt: f.dismissed ? new Date() : null,
        ruleRefs: f.ruleRefs ?? null,
      })),
    );
  }
  return review!;
}
