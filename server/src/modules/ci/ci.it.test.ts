/**
 * CI module integration tests (Testcontainers Postgres).
 *
 * Tests:
 *   1. POST /agents/:id/export-ci (action=open_pr)
 *      → inserts ci_installation + calls MockGitHubClient.commitFiles + openPullRequest
 *   2. POST /ci-runs/refresh with mock 200
 *      → ci_runs row + agent_runs(source=ci) + ci_run_findings inserted
 *   3. POST /ci-runs/refresh with mock 304 (same ETag)
 *      → no new ci_runs rows (idempotent)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  startPg,
  dockerAvailable,
  type PgFixture,
} from "../../../test/helpers/pg.js";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../platform/config.js";
import { seed } from "../../db/seed.js";
import { MockGitHubClient } from "../../adapters/mocks.js";
import * as t from "../../db/schema.js";
import { buildZip } from "./zip.js";

// ---------------------------------------------------------------------------
// Mock assembleFiles so tests don't need agent-runner/dist/index.js on disk
// ---------------------------------------------------------------------------
vi.mock("./generators/index.js", () => ({
  assembleFiles: vi.fn().mockReturnValue([
    {
      path: ".github/workflows/devdigest-review.yml",
      contents: "# workflow\n",
      editable: true,
    },
    {
      path: ".devdigest/agents/test-agent.yaml",
      contents: "name: test\n",
      editable: false,
    },
  ]),
  kebabSlug: (s: string) => s.toLowerCase().replace(/\s+/g, "-"),
  dedupeSlugs: (names: string[]) =>
    names.map((n: string) => n.toLowerCase().replace(/\s+/g, "-")),
  agentYaml: () => "name: test\n",
  workflowYml: () => "# workflow\n",
}));

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () =>
  loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);

/** Build a proper ZIP buffer wrapping devdigest-result.json content. */
function makeArtifactZip(payload: object): Buffer {
  const json = JSON.stringify(payload);
  return buildZip([{ path: "devdigest-result.json", contents: json }]);
}

/** Minimal valid artifact with findings. */
const ARTIFACT_WITH_FINDINGS = {
  findings_count: 2,
  critical: 1,
  warning: 1,
  suggestion: 0,
  cost_usd: 0.002,
  duration_ms: 3000,
  agent: "Test Agent",
  version: "1.0.0",
  pr_number: 42,
  findings: [
    {
      id: "f-1",
      file: "src/app.ts",
      start_line: 10,
      end_line: 10,
      severity: "CRITICAL",
      category: "security",
      title: "SQL Injection risk",
      rationale: "Unparameterized query.",
      confidence: 0.95,
      kind: "finding",
    },
    {
      id: "f-2",
      file: "src/utils.ts",
      start_line: 5,
      end_line: 7,
      severity: "WARNING",
      category: "bug",
      title: "Possible null dereference",
      rationale: "Value can be null.",
      confidence: 0.8,
      kind: "finding",
    },
  ],
};

d("CI module (Testcontainers pg)", () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: "acme",
        name: "ci-test-repo",
        fullName: "acme/ci-test-repo",
      })
      .returning();
    repoId = repo!.id;

    // Seed agent directly (bypass POST /agents due to pre-existing repo_id bug)
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        repoId,
        name: "CI Test Agent",
        provider: "openrouter",
        model: "gpt-4.1",
        systemPrompt: "Review PRs.",
      })
      .returning();
    agentId = agent!.id;

    await pg.handle.db.insert(t.agentVersions).values({
      agentId,
      version: 1,
      configJson: {
        provider: agent!.provider,
        model: agent!.model,
        system_prompt: agent!.systemPrompt,
        output_schema: null,
        strategy: agent!.strategy,
        ci_fail_on: agent!.ciFailOn,
        repo_intel: null,
        skills: [],
      },
    });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  // ---- Test 1: export open_pr -----------------------------------------------

  it("export open_pr → inserts ci_installation + calls commitFiles + openPullRequest", async () => {
    const mockGh = new MockGitHubClient();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: mockGh },
    });

    const res = await app.inject({
      method: "POST",
      url: `/agents/${agentId}/export-ci`,
      payload: {
        repo: "acme/ci-test-repo",
        target: "gha",
        action: "open_pr",
        post_as: "github_review",
        triggers: ["opened", "synchronize"],
        base: "main",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty("installation");
    expect(body.installation.repo).toBe("acme/ci-test-repo");
    expect(body.installation.target_type).toBe("gha");

    // GitHub client was called
    expect(mockGh.committed.length).toBe(1);
    expect(mockGh.committed[0]!.branch).toBe("devdigest/ci");
    expect(mockGh.openedPrs.length).toBe(1);
    expect(mockGh.openedPrs[0]!.head).toBe("devdigest/ci");

    // DB row was inserted
    const installations = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(installations.length).toBeGreaterThanOrEqual(1);
    expect(installations[0]!.repo).toBe("acme/ci-test-repo");
  });

  // ---- Test 2: ingest 200 → ci_runs + agent_runs + ci_run_findings ----------

  it("ingest with mock 200 → ci_runs row + agent_runs(source=ci) + ci_run_findings", async () => {
    // Ensure installation exists (from test 1 or insert fresh)
    const [existingInstall] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));

    let installId: string;
    if (existingInstall) {
      installId = existingInstall.id;
    } else {
      const [inst] = await pg.handle.db
        .insert(t.ciInstallations)
        .values({ agentId, repo: "acme/ci-test-repo", targetType: "gha" })
        .returning();
      installId = inst!.id;
    }

    const artifactZip = makeArtifactZip(ARTIFACT_WITH_FINDINGS);

    const mockGh = new MockGitHubClient({
      etag: "etag-v1",
      workflowRuns: [
        {
          id: 1001,
          status: "completed",
          conclusion: "failure", // gate-blocked but artifact EXISTS → "succeeded"
          prNumber: 42,
          headSha: "abc123",
          htmlUrl: "https://github.com/acme/ci-test-repo/actions/runs/1001",
          artifacts: [{ id: 9001, name: "devdigest-result" }],
        },
      ],
      artifacts: { "9001": artifactZip },
    });

    // Count rows before ingest
    const runsBefore = await pg.handle.db.select().from(t.ciRuns);
    const agentRunsBefore = await pg.handle.db.select().from(t.agentRuns);

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: mockGh },
    });

    const res = await app.inject({
      method: "POST",
      url: "/ci-runs/refresh",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ingested).toBeGreaterThanOrEqual(1);
    expect(body.installations_checked).toBeGreaterThanOrEqual(1);

    // ci_runs row
    const runsAfter = await pg.handle.db.select().from(t.ciRuns);
    expect(runsAfter.length).toBeGreaterThan(runsBefore.length);
    const newRun = runsAfter.find(
      (r) =>
        r.githubUrl ===
        "https://github.com/acme/ci-test-repo/actions/runs/1001",
    );
    expect(newRun).toBeDefined();
    expect(newRun!.status).toBe("succeeded"); // gate-blocked → succeeded (artifact exists)
    expect(newRun!.findingsCount).toBe(2);
    expect(newRun!.critical).toBe(1);

    // agent_runs row with source='ci'
    const agentRunsAfter = await pg.handle.db.select().from(t.agentRuns);
    expect(agentRunsAfter.length).toBeGreaterThan(agentRunsBefore.length);
    const newAgentRun = agentRunsAfter.find(
      (r) => r.source === "ci" && r.agentId === agentId,
    );
    expect(newAgentRun).toBeDefined();
    expect(newAgentRun!.status).toBe("succeeded");

    // ci_run_findings rows
    const findings = await pg.handle.db
      .select()
      .from(t.ciRunFindings)
      .where(eq(t.ciRunFindings.ciRunId, newRun!.id));
    expect(findings.length).toBe(2);
    expect(findings.some((f) => f.severity === "CRITICAL")).toBe(true);
    expect(findings.some((f) => f.severity === "WARNING")).toBe(true);
  });

  // ---- Test 3: ingest 304 → no new rows ------------------------------------

  it("ingest with mock 304 (same ETag) → no new ci_runs rows", async () => {
    // Get the current ETag stored on the installation (set by test 2)
    const [install] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));

    const storedEtag = install?.lastSyncedEtag ?? "etag-v1";

    // Mock returns 304 when the stored ETag matches
    const mockGh = new MockGitHubClient({
      etag: storedEtag,
      workflowRuns: [], // won't be used (304)
    });

    const runsBefore = await pg.handle.db.select().from(t.ciRuns);

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: mockGh },
    });

    // The mock returns 304 when the request ETag matches the stored ETag.
    // BUT: the installation's lastSyncedEtag was set to storedEtag in test 2.
    // The mock's own etag IS storedEtag, so passing storedEtag as request etag
    // triggers 304.
    const res = await app.inject({
      method: "POST",
      url: "/ci-runs/refresh",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ingested).toBe(0);

    // No new ci_runs rows
    const runsAfter = await pg.handle.db.select().from(t.ciRuns);
    expect(runsAfter.length).toBe(runsBefore.length);
  });
});
