import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import * as t from "./schema.js";

/**
 * Demo data for the Agent Performance dashboard, Agent Stats and Skill Stats.
 *
 * Called ONLY from the CLI entry of `seed.ts` (`pnpm db:seed`), never from the
 * exported `seed(db)` that integration tests share — so it cannot change their
 * row counts.
 *
 * Properties:
 *  - Idempotent: every row has a deterministic id and is inserted with
 *    `ON CONFLICT`. Re-running does not duplicate anything; run times are
 *    refreshed relative to "now" so the demo never drifts out of the window.
 *  - 65 days of history, so every "previous window" delta exists for the 30-day view.
 *  - No `running` runs (a seeded run would look forever in progress on the PR
 *    page); `cancelled`, `failed`, deleted-agent, CI, legacy and no-cost runs
 *    are all present so every exclusion/empty-state rule is visible.
 *  - Every memory entry has an embedding (deterministic pseudo-random unit
 *    vectors — no embedder call, so seeding stays offline).
 *  - The numbers are DEMO data. In real use they come from real reviews.
 */

/** 65 days: a 30-day view needs history before its previous window (60 days back) for the cost delta. */
const HISTORY_DAYS = 65;
/** Keeps the run density per day roughly constant as the history grows. */
const RUN_SCALE = 1.7;
/** Skill/memory/cost-source/memory-mode tracking "started" this many days ago. */
const TRACKING_DAYS = 22;
const EXTRA_PRS = 20;
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Deterministic UUID for the n-th seeded row of a table (tables use disjoint ranges). */
const seedUuid = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const ID = {
  agent: 0x100,
  pr: 0x1000,
  run: 0x10000,
  review: 0x40000,
  finding: 0x80000,
  memory: 0x200,
  ciRun: 0x400,
} as const;

/** Small seedable PRNG so the demo data is identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function unitVector(seed: number, dims = 1536): number[] {
  const rand = mulberry32(seed);
  const v = Array.from({ length: dims }, () => rand() * 2 - 1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => Number((x / norm).toFixed(6)));
}

interface AgentPlan {
  name: string;
  runs: number;
  model: string;
  /** Typical cost / duration per run. */
  cost: number;
  durationS: number;
  /** Share of resolved findings that get accepted. */
  accept: number;
  /** Category weights: security, bug, perf, style, test. */
  categories: [number, number, number, number, number];
  enabled?: boolean;
  /** Skill names this agent has attached (usage records are written for them). */
  skills?: string[];
}

const SKILL_APPLY_RATE: Record<string, number> = {
  "Secret Leakage Gate": 0.92,
  "Lethal Trifecta": 0.88,
  "PR Quality Rubric": 0.71,
  "No .then() Chains": 0.34,
  "Test Coverage Nudge": 0.22,
};

const AGENT_PLANS: AgentPlan[] = [
  {
    name: "Security Reviewer",
    runs: 90,
    model: "gpt-4.1",
    cost: 0.04,
    durationS: 6.2,
    accept: 0.78,
    categories: [6, 2, 1, 1, 0],
    skills: Object.keys(SKILL_APPLY_RATE),
  },
  { name: "Performance Reviewer", runs: 55, model: "gpt-4o", cost: 0.05, durationS: 7.1, accept: 0.64, categories: [1, 2, 6, 1, 0] },
  { name: "General Reviewer", runs: 40, model: "gpt-4o-mini", cost: 0.012, durationS: 4.4, accept: 0.55, categories: [1, 5, 1, 3, 1] },
  { name: "API Contract Reviewer", runs: 25, model: "claude-sonnet-4-5", cost: 0.06, durationS: 8.3, accept: 0.7, categories: [1, 4, 1, 2, 1] },
  { name: "Test Quality Reviewer", runs: 15, model: "gpt-4o-mini", cost: 0.015, durationS: 5, accept: 0.5, categories: [0, 2, 0, 1, 6] },
  { name: "Docs Reviewer", runs: 6, model: "gpt-4o-mini", cost: 0.008, durationS: 3.5, accept: 0.4, categories: [0, 1, 0, 6, 0], enabled: false },
  // "Custom Mentor": an agent that exists but never ran (the "agent without runs" state).
  { name: "Custom Mentor", runs: 0, model: "gpt-4o-mini", cost: 0.03, durationS: 5, accept: 0.41, categories: [0, 1, 0, 3, 0] },
];

const MEMORY_ENTRIES = [
  "raw-body parser is intentional for the Stripe webhook route",
  "bucketKey carries a version prefix; never strip it",
  "house style is snake_case for database columns",
  "migrations ship alone, never mixed with feature code",
  "prefer vitest over jest in this repository",
  "all money amounts are integer cents, never floats",
];
/** Probability that each memory entry is selected into a (top-K) run. */
const MEMORY_PULL_RATE = [0.64, 0.51, 0.38, 0.29, 0.18, 0.1];

const pick = <T>(rand: () => number, items: readonly T[], weights: readonly number[]): T => {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
};

const CATEGORIES = ["security", "bug", "perf", "style", "test"] as const;
const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

const batches = <T>(rows: T[], size = 400): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

export async function seedPerformanceDemo(
  db: Db,
  opts: { workspaceId: string; now?: Date },
): Promise<{ runs: number; findings: number }> {
  const now = opts.now ?? new Date();
  const workspaceId = opts.workspaceId;
  const rand = mulberry32(20261011);

  // ---- repo, owner (created by the base seed) ------------------------------
  const [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, "acme/payments-api")));
  if (!repo) throw new Error("Run the base seed first (demo repo missing).");
  const repoId = repo.id;
  const [owner] = await db.select().from(t.users).limit(1);

  // ---- extra PRs (pull frequency needs several) ----------------------------
  const prRows = Array.from({ length: EXTRA_PRS }, (_, i) => ({
    id: seedUuid(ID.pr + i),
    workspaceId,
    repoId,
    number: 1001 + i,
    title: `Demo PR ${1001 + i}: ${["Add retry to webhook sender", "Refactor ledger service", "Fix N+1 in invoice list", "Bump dependencies", "Document refund flow"][i % 5]}`,
    author: ["marisa.koch", "dev.one", "dev.two"][i % 3]!,
    branch: `demo/pr-${1001 + i}`,
    base: "main",
    headSha: `demo${(1001 + i).toString(16)}`,
    additions: 20 + ((i * 37) % 300),
    deletions: 5 + ((i * 13) % 80),
    filesCount: 2 + (i % 9),
    status: "needs_review" as const,
    body: "Seeded demo pull request for the performance dashboard.",
  }));
  await db.insert(t.pullRequests).values(prRows).onConflictDoNothing();
  const prs = await db
    .select({ id: t.pullRequests.id, number: t.pullRequests.number })
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), inArray(t.pullRequests.number, prRows.map((p) => p.number))));
  const prIds = prs.map((p) => p.id);

  // ---- agents (existing ones are reused by name) ---------------------------
  const agentIdByName = new Map<string, string>();
  for (const [i, plan] of AGENT_PLANS.entries()) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, plan.name)));
    if (existing) {
      agentIdByName.set(plan.name, existing.id);
      continue;
    }
    const [created] = await db
      .insert(t.agents)
      .values({
        id: seedUuid(ID.agent + i),
        workspaceId,
        repoId,
        name: plan.name,
        description: `Demo agent: ${plan.name}`,
        provider: "openai",
        model: plan.model,
        systemPrompt: `You are the ${plan.name}. Review the diff and return at most 5 high-signal findings.`,
        enabled: plan.enabled ?? true,
        version: 1,
        createdBy: owner?.id ?? null,
      })
      .onConflictDoNothing()
      .returning();
    const id = created?.id ?? seedUuid(ID.agent + i);
    agentIdByName.set(plan.name, id);
  }

  // ---- skills: the five used for the usage-spread demo ---------------------
  const skillRows = await db
    .select({ id: t.skills.id, name: t.skills.name, version: t.skills.version })
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.name, Object.keys(SKILL_APPLY_RATE))));
  const skillByName = new Map(skillRows.map((s) => [s.name, s]));
  const securityId = agentIdByName.get("Security Reviewer")!;
  for (const [order, name] of Object.keys(SKILL_APPLY_RATE).entries()) {
    const skill = skillByName.get(name);
    if (skill) {
      await db.insert(t.agentSkills).values({ agentId: securityId, skillId: skill.id, order }).onConflictDoNothing();
    }
  }

  // ---- memory entries, all with embeddings ----------------------------------
  const memoryRows = MEMORY_ENTRIES.map((content, i) => ({
    id: seedUuid(ID.memory + i),
    workspaceId,
    scope: "global" as const,
    kind: "convention" as const,
    content,
    embedding: unitVector(7000 + i),
    confidence: 0.85,
    source: "explicit" as const,
  }));
  await db.insert(t.memory).values(memoryRows).onConflictDoNothing();

  // ---- CI installation + CI runs (with their findings) ----------------------
  const [existingInst] = await db
    .select()
    .from(t.ciInstallations)
    .where(and(eq(t.ciInstallations.agentId, securityId), eq(t.ciInstallations.repo, "acme/payments-api")));
  const installationId =
    existingInst?.id ??
    (
      await db
        .insert(t.ciInstallations)
        .values({ agentId: securityId, repo: "acme/payments-api", targetType: "gha" })
        .returning()
    )[0]!.id;

  const ciRunPlans = Array.from({ length: 8 }, (_, i) => {
    const status = i === 3 ? "failed" : i === 5 ? "no_findings" : "succeeded";
    const findings = status === "succeeded" ? 1 + (i % 3) : 0;
    return { i, status, findings, ranAt: new Date(now.getTime() - (i * 4 + 1) * DAY - 3 * HOUR) };
  });
  const ciRunIds = ciRunPlans.map((p) => seedUuid(ID.ciRun + p.i));
  await db
    .insert(t.ciRuns)
    .values(
      ciRunPlans.map((p) => ({
        id: seedUuid(ID.ciRun + p.i),
        ciInstallationId: installationId,
        prNumber: 1001 + p.i,
        prTitle: prRows[p.i]!.title,
        ranAt: p.ranAt,
        status: p.status,
        findingsCount: p.findings,
        critical: p.findings > 1 ? 1 : 0,
        warning: p.findings > 0 ? 1 : 0,
        suggestion: p.findings > 2 ? 1 : 0,
        durationMs: p.status === "failed" ? 0 : 6500 + p.i * 400,
        costUsd: p.status === "failed" ? 0 : 0.05 + p.i * 0.004,
        githubUrl: `https://github.com/acme/payments-api/actions/runs/9000${p.i}`,
        source: "gha",
      })),
    )
    .onConflictDoNothing();
  // Refresh run times relative to now on re-seed.
  for (const p of ciRunPlans) {
    await db.update(t.ciRuns).set({ ranAt: p.ranAt }).where(eq(t.ciRuns.id, seedUuid(ID.ciRun + p.i)));
  }
  const ciFindingRows = ciRunPlans.flatMap((p) =>
    Array.from({ length: p.findings }, (_, k) => ({
      id: seedUuid(ID.finding + 0x40000 + p.i * 8 + k),
      ciRunId: seedUuid(ID.ciRun + p.i),
      file: "src/payments/webhook.ts",
      startLine: 10 + k,
      endLine: 10 + k,
      severity: SEVERITIES[(p.i + k) % 3]!,
      category: CATEGORIES[(p.i + k) % 5]!,
      title: `CI finding ${p.i}-${k}`,
      rationale: "Seeded CI finding.",
      confidence: 0.8,
    })),
  );
  if (ciFindingRows.length > 0) {
    await db.insert(t.ciRunFindings).values(ciFindingRows).onConflictDoNothing();
  }

  // ---- agent runs ------------------------------------------------------------
  type RunInsert = typeof t.agentRuns.$inferInsert;
  const runs: RunInsert[] = [];
  const reviewPlans: { runIdx: number; agentName: string; legacy: boolean }[] = [];
  let runCounter = 0;
  const nextRunId = () => seedUuid(ID.run + runCounter++);

  for (const plan of AGENT_PLANS) {
    const agentId = agentIdByName.get(plan.name)!;
    for (let k = 0; k < Math.round(plan.runs * RUN_SCALE); k++) {
      // The first six runs of the first agent land inside the last day so the
      // "1 day" view has data in several slots.
      const hoursBack =
        plan.name === "Security Reviewer" && k < 6
          ? 1 + k * 3.2 + rand()
          : rand() * HISTORY_DAYS * 24;
      const ranAt = new Date(now.getTime() - hoursBack * HOUR);
      const legacy = hoursBack > TRACKING_DAYS * 24;
      const statusRoll = rand();
      const status = statusRoll < 0.88 ? "done" : statusRoll < 0.96 ? "failed" : "cancelled";
      const noCost = status !== "done" || rand() < 0.05;
      const cost = plan.cost * (0.6 + rand() * 0.9);
      const costSource: RunInsert["costSource"] =
        noCost || legacy ? null : rand() < 0.4 ? "api" : "estimate";
      runs.push({
        id: nextRunId(),
        workspaceId,
        agentId,
        prId: prIds[Math.floor(rand() * prIds.length)] ?? null,
        ranAt,
        provider: "openai",
        model: plan.model,
        durationMs: status === "done" ? Math.round(plan.durationS * 1000 * (0.7 + rand() * 0.7)) : status === "failed" ? 400 : null,
        tokensIn: 8000 + Math.floor(rand() * 14000),
        tokensOut: 600 + Math.floor(rand() * 2200),
        costUsd: noCost ? null : Number(cost.toFixed(5)),
        costSource,
        status,
        error: status === "failed" ? "LLM request failed: upstream timeout" : null,
        source: "local",
        findingsCount: null,
        memoryMode: legacy ? null : rand() < 0.08 ? "fallback" : "top_k",
      });
      if (status === "done") reviewPlans.push({ runIdx: runs.length - 1, agentName: plan.name, legacy });
    }
  }

  // Runs of a deleted agent (agent_id is NULL after the agent was removed).
  for (let k = 0; k < 5; k++) {
    runs.push({
      id: nextRunId(),
      workspaceId,
      agentId: null,
      prId: prIds[k] ?? null,
      ranAt: new Date(now.getTime() - (2 + k * 5) * DAY),
      provider: "openai",
      model: "gpt-4o",
      durationMs: 5200,
      tokensIn: 9000,
      tokensOut: 900,
      costUsd: 0.045,
      costSource: null,
      status: "done",
      source: "local",
    });
  }

  // CI agent runs, linked to their CI runs (+ one legacy CI run without a link).
  for (const p of ciRunPlans) {
    runs.push({
      id: nextRunId(),
      workspaceId,
      agentId: securityId,
      prId: null,
      ranAt: p.ranAt,
      model: null,
      durationMs: p.status === "failed" ? null : 6500 + p.i * 400,
      costUsd: p.status === "failed" ? null : 0.05 + p.i * 0.004,
      costSource: null,
      status: p.status,
      source: "ci",
      ciRunId: ciRunIds[p.i]!,
      findingsCount: p.findings,
    });
  }
  runs.push({
    id: nextRunId(),
    workspaceId,
    agentId: securityId,
    prId: null,
    ranAt: new Date(now.getTime() - 33 * DAY),
    model: null,
    costUsd: 0.05,
    status: "succeeded",
    source: "ci",
    findingsCount: 0,
  });
  // Cancelled-looking noise that must never count: extra cancelled runs.
  for (let k = 0; k < 3; k++) {
    runs.push({
      id: nextRunId(),
      workspaceId,
      agentId: securityId,
      prId: prIds[k] ?? null,
      ranAt: new Date(now.getTime() - (k + 1) * DAY),
      model: "gpt-4.1",
      status: "cancelled",
      source: "local",
      costUsd: 9.99,
    });
  }

  for (const chunk of batches(runs)) {
    await db
      .insert(t.agentRuns)
      .values(chunk)
      .onConflictDoNothing();
  }
  // Refresh run times relative to now (so re-seeding keeps the demo in-window).
  for (const r of runs) {
    await db.update(t.agentRuns).set({ ranAt: r.ranAt as Date }).where(eq(t.agentRuns.id, r.id as string));
  }

  // ---- reviews + findings (with accept/dismiss decisions and rule_refs) -----
  const planByName = new Map(AGENT_PLANS.map((p) => [p.name, p]));
  const reviewRows: (typeof t.reviews.$inferInsert)[] = [];
  const findingRows: (typeof t.findings.$inferInsert)[] = [];
  const skillIdsForRefs = Object.keys(SKILL_APPLY_RATE).map((n) => skillByName.get(n)?.id);
  let findingCounter = 0;

  for (const [rIdx, rp] of reviewPlans.entries()) {
    const run = runs[rp.runIdx]!;
    const plan = planByName.get(rp.agentName)!;
    const reviewId = seedUuid(ID.review + rIdx);
    const ranAt = run.ranAt as Date;
    const count = pick(rand, [0, 1, 2, 3, 4], [1, 3, 3, 2, 1]);
    reviewRows.push({
      id: reviewId,
      workspaceId,
      prId: run.prId ?? prIds[0]!,
      agentId: run.agentId ?? null,
      runId: run.id as string,
      kind: "review",
      verdict: count > 2 ? "request_changes" : "comment",
      summary: "Seeded review.",
      score: 100 - count * 12,
      model: plan.model,
      createdAt: ranAt,
    });
    for (let k = 0; k < count; k++) {
      const category = pick(rand, CATEGORIES, plan.categories);
      const severity = pick(rand, SEVERITIES, [1, 3, 3]);
      const decision = rand();
      const resolvedProb = 0.85;
      const accepted = decision < resolvedProb * plan.accept;
      const dismissed = !accepted && decision < resolvedProb;
      const citesSkill = rp.agentName === "Security Reviewer" && !rp.legacy;
      const refs = citesSkill
        ? skillIdsForRefs.filter((id, si) => id && rand() < Object.values(SKILL_APPLY_RATE)[si]! * 0.5)
        : [];
      findingRows.push({
        id: seedUuid(ID.finding + findingCounter++),
        reviewId,
        file: `src/${category}/handler-${k}.ts`,
        startLine: 10 + k * 7,
        endLine: 10 + k * 7,
        severity,
        category,
        title: `Seeded ${category} finding`,
        rationale: "Seeded finding for the performance dashboard.",
        confidence: 0.6 + rand() * 0.4,
        acceptedAt: accepted ? new Date(ranAt.getTime() + 2 * HOUR) : null,
        dismissedAt: dismissed ? new Date(ranAt.getTime() + 3 * HOUR) : null,
        ruleRefs: refs.length > 0 ? (refs as string[]) : null,
      });
    }
    run.findingsCount = count;
  }
  for (const chunk of batches(reviewRows)) {
    await db.insert(t.reviews).values(chunk).onConflictDoNothing();
  }
  for (const chunk of batches(findingRows)) {
    await db.insert(t.findings).values(chunk).onConflictDoNothing();
  }
  for (const r of runs) {
    if (r.findingsCount != null && r.source === "local") {
      await db.update(t.agentRuns).set({ findingsCount: r.findingsCount }).where(eq(t.agentRuns.id, r.id as string));
    }
  }

  // ---- skill + memory usage records -----------------------------------------
  const runSkillRows: (typeof t.agentRunSkills.$inferInsert)[] = [];
  const runMemoryRows: (typeof t.agentRunMemory.$inferInsert)[] = [];
  for (const run of runs) {
    if (run.source !== "local" || run.status !== "done" || !run.agentId) continue;
    const recent = (run.ranAt as Date).getTime() > now.getTime() - TRACKING_DAYS * DAY;
    if (!recent) continue;
    const agentName = [...agentIdByName.entries()].find(([, id]) => id === run.agentId)?.[0];
    const plan = agentName ? planByName.get(agentName) : undefined;

    for (const skillName of plan?.skills ?? []) {
      const skill = skillByName.get(skillName);
      if (!skill) continue;
      runSkillRows.push({
        runId: run.id as string,
        skillId: skill.id,
        skillVersion: skill.version,
        applied: rand() < SKILL_APPLY_RATE[skillName]!,
        findingsCited: Math.floor(rand() * 3),
      });
    }

    if (run.memoryMode === "top_k") {
      // Some top-K runs legitimately select nothing (0 records, mode still recorded).
      const selected = rand() < 0.15 ? [] : MEMORY_PULL_RATE.map((p, i) => (rand() < p ? i : -1)).filter((i) => i >= 0);
      selected.slice(0, 5).forEach((memIdx, rank) => {
        runMemoryRows.push({
          runId: run.id as string,
          memoryId: seedUuid(ID.memory + memIdx),
          rank: rank + 1,
          similarity: Number((0.9 - rank * 0.06 - rand() * 0.04).toFixed(4)),
        });
      });
    } else if (run.memoryMode === "fallback") {
      runMemoryRows.push({
        runId: run.id as string,
        memoryId: seedUuid(ID.memory),
        rank: 1,
        similarity: null,
      });
    }
  }
  for (const chunk of batches(runSkillRows)) {
    await db.insert(t.agentRunSkills).values(chunk).onConflictDoNothing();
  }
  for (const chunk of batches(runMemoryRows)) {
    await db.insert(t.agentRunMemory).values(chunk).onConflictDoNothing();
  }

  return { runs: runs.length, findings: findingRows.length };
}
