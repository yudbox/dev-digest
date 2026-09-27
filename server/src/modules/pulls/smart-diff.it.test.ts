/**
 * TASK-001 (SPEC-2026-09-23-smart-diff-hw3-upgrade, AC-10): integration test
 * for `GET /pulls/:id/smart-diff`'s `line_findings` — the ONLY data source
 * for every finding indicator in the diff (group counter, file dot, chips,
 * markers, cards). Mirrors the setup style of
 * `pulls-detail.characterization.it.test.ts` (real Postgres via
 * testcontainers, `MockGitHubClient`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPg, dockerAvailable, type PgFixture } from "../../../test/helpers/pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { seed } from "../../db/seed.js";
import { MockGitHubClient } from "../../adapters/mocks.js";
import * as t from "../../db/schema.js";
import type { SmartDiff } from "@devdigest/shared";

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () =>
  loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture["handle"]["db"], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: "acme", name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: "Smart Diff findings PR",
      author: "marisa.koch",
      branch: "feat/smart-diff",
      base: "main",
      headSha: "deadbeef",
      additions: 10,
      deletions: 2,
      filesCount: 3,
      status: "open",
    })
    .returning();

  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: "src/foo.ts", additions: 5, deletions: 0, patch: null },
    { prId: pr!.id, path: "src/a.test.ts", additions: 4, deletions: 1, patch: null },
    { prId: pr!.id, path: "docs/readme.md", additions: 1, deletions: 1, patch: null },
  ]);

  return { repo: repo!, pr: pr! };
}

async function insertReview(
  db: PgFixture["handle"]["db"],
  values: {
    workspaceId: string;
    prId: string;
    agentId: string;
    createdAt: Date;
  },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId: values.workspaceId,
      prId: values.prId,
      agentId: values.agentId,
      runId: null,
      kind: "review",
      verdict: "comment",
      summary: "ok",
      score: 80,
      model: "test-model",
      createdAt: values.createdAt,
    })
    .returning();
  return review!;
}

async function insertFinding(
  db: PgFixture["handle"]["db"],
  values: {
    reviewId: string;
    file: string;
    startLine: number;
    severity: string;
    title: string;
    acceptedAt?: Date | null;
    dismissedAt?: Date | null;
  },
) {
  const [row] = await db
    .insert(t.findings)
    .values({
      reviewId: values.reviewId,
      file: values.file,
      startLine: values.startLine,
      endLine: values.startLine,
      severity: values.severity,
      category: "bug",
      title: values.title,
      rationale: `Rationale for ${values.title}`,
      suggestion: `Suggestion for ${values.title}`,
      confidence: 0.9,
      kind: "finding",
      acceptedAt: values.acceptedAt ?? null,
      dismissedAt: values.dismissedAt ?? null,
    })
    .returning();
  return row!;
}

d("GET /pulls/:id/smart-diff — line_findings (Testcontainers pg)", () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("returns line_findings: null for every file before any review has run", async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: "GET", url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    for (const group of body.groups) {
      for (const file of group.files) {
        expect(file.line_findings).toBeNull();
      }
    }

    await app.close();
  });

  it("unions latest-per-agent findings, drops dismissed, keeps accepted, ignores older runs", async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agentA = crypto.randomUUID();
    const agentB = crypto.randomUUID();

    // Agent A — older run (should be entirely excluded from the response).
    const reviewAOld = await insertReview(pg.handle.db, {
      workspaceId,
      prId: pr.id,
      agentId: agentA,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await insertFinding(pg.handle.db, {
      reviewId: reviewAOld.id,
      file: "src/a.test.ts",
      startLine: 10,
      severity: "WARNING",
      title: "Stale finding from an older run",
    });

    // Agent A — latest run: 3 findings on the same line (active, accepted, dismissed).
    const reviewANew = await insertReview(pg.handle.db, {
      workspaceId,
      prId: pr.id,
      agentId: agentA,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    const activeFinding = await insertFinding(pg.handle.db, {
      reviewId: reviewANew.id,
      file: "src/a.test.ts",
      startLine: 20,
      severity: "CRITICAL",
      title: "Active finding",
    });
    const acceptedFinding = await insertFinding(pg.handle.db, {
      reviewId: reviewANew.id,
      file: "src/a.test.ts",
      startLine: 20,
      severity: "WARNING",
      title: "Accepted finding",
      acceptedAt: new Date("2026-02-02T00:00:00Z"),
    });
    await insertFinding(pg.handle.db, {
      reviewId: reviewANew.id,
      file: "src/a.test.ts",
      startLine: 20,
      severity: "SUGGESTION",
      title: "Dismissed finding",
      dismissedAt: new Date("2026-02-02T00:00:00Z"),
    });

    // Agent B — one review, one finding on the docs file.
    const reviewB = await insertReview(pg.handle.db, {
      workspaceId,
      prId: pr.id,
      agentId: agentB,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    await insertFinding(pg.handle.db, {
      reviewId: reviewB.id,
      file: "docs/readme.md",
      startLine: 3,
      severity: "SUGGESTION",
      title: "Docs finding",
    });

    const res = await app.inject({ method: "GET", url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    // All five groups, always, in display order — wiring/boilerplate are empty here.
    expect(body.groups.map((g) => g.role)).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
    expect(body.groups.find((g) => g.role === "wiring")!.files).toEqual([]);
    expect(body.groups.find((g) => g.role === "boilerplate")!.files).toEqual([]);

    const coreFile = body.groups
      .find((g) => g.role === "core")!
      .files.find((f) => f.path === "src/foo.ts")!;
    expect(coreFile.line_findings).toEqual([]);

    const testFile = body.groups
      .find((g) => g.role === "tests")!
      .files.find((f) => f.path === "src/a.test.ts")!;
    expect(testFile.line_findings).toHaveLength(2);
    const ids = testFile.line_findings!.map((f) => f.id).sort();
    expect(ids).toEqual([activeFinding.id, acceptedFinding.id].sort());
    // None from the older run.
    expect(testFile.line_findings!.some((f) => f.title === "Stale finding from an older run")).toBe(
      false,
    );
    // Full FindingRecord fields are present.
    const active = testFile.line_findings!.find((f) => f.id === activeFinding.id)!;
    expect(active.rationale).toBe("Rationale for Active finding");
    expect(active.suggestion).toBe("Suggestion for Active finding");
    expect(active.category).toBe("bug");
    expect(active.confidence).toBe(0.9);
    expect(active.accepted_at).toBeNull();
    const accepted = testFile.line_findings!.find((f) => f.id === acceptedFinding.id)!;
    expect(accepted.accepted_at).not.toBeNull();

    const docsFile = body.groups
      .find((g) => g.role === "docs")!
      .files.find((f) => f.path === "docs/readme.md")!;
    expect(docsFile.line_findings).toHaveLength(1);
    expect(docsFile.line_findings![0]!.file).toBe("docs/readme.md");

    // No removed fields anywhere in the response.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("finding_lines");
    expect(raw).not.toContain("severity_counts");
    expect(raw).not.toContain("replied_at");

    await app.close();
  });
});
