/**
 * Unit tests for CiService.
 *
 * Tests the pure `deriveRunStatus` logic (table-driven) and verifies that
 * exportCi with action=files does NOT create a ci_installation row.
 *
 * All DB + GitHub calls are mocked — no Postgres required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveRunStatus, CiService } from "./service.js";
import type { Container } from "../../platform/container.js";
import type { CiInstallation } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Mock assembleFiles so tests don't need agent-runner/dist/index.js on disk
// ---------------------------------------------------------------------------
vi.mock("./generators/index.js", () => ({
  assembleFiles: vi.fn().mockReturnValue([
    {
      path: ".github/workflows/devdigest-review.yml",
      contents: "# workflow",
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

// ---------------------------------------------------------------------------
// deriveRunStatus — table-driven tests
// ---------------------------------------------------------------------------

describe("deriveRunStatus", () => {
  it.each([
    {
      desc: "no artifact → failed",
      hasArtifact: false,
      findingsCount: 0,
      expected: "failed",
    },
    {
      desc: "no artifact (even with findings would be) → failed",
      hasArtifact: false,
      findingsCount: 5,
      expected: "failed",
    },
    {
      desc: "artifact + findings > 0 → succeeded",
      hasArtifact: true,
      findingsCount: 3,
      expected: "succeeded",
    },
    {
      desc: "artifact + 0 findings → no_findings",
      hasArtifact: true,
      findingsCount: 0,
      expected: "no_findings",
    },
    {
      // Gate-blocked: GH Actions job is red because DevDigest found issues,
      // BUT the artifact WAS uploaded → runner completed successfully.
      desc: "gate-blocked run (artifact exists, conclusion=failure) → succeeded",
      hasArtifact: true,
      findingsCount: 5,
      expected: "succeeded",
    },
  ])("$desc", ({ hasArtifact, findingsCount, expected }) => {
    expect(deriveRunStatus(hasArtifact, findingsCount)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// exportCi action=files — does NOT create a ci_installation
// ---------------------------------------------------------------------------

describe("CiService.exportCi action=files", () => {
  const mockInstallRow = {
    id: "install-1",
    agentId: "agent-1",
    repo: "owner/repo",
    targetType: "gha" as const,
    installedAt: new Date(),
    lastSyncedEtag: null,
    lastSyncedAt: null,
  };

  const mockAgent = {
    id: "agent-1",
    name: "Test Agent",
    provider: "openrouter",
    model: "gpt-4.1",
    systemPrompt: "Review this PR.",
    strategy: "auto",
    ciFailOn: "critical",
  };

  function makeMockContainer(upsertInstallation: ReturnType<typeof vi.fn>) {
    return {
      agentsRepo: {
        getById: vi.fn().mockResolvedValue(mockAgent),
        linkedSkills: vi.fn().mockResolvedValue([]),
      },
      reposRepo: {
        findByFullName: vi.fn().mockResolvedValue(null),
      },
      ciRepo: {
        upsertInstallation,
        listInstallationsForAgent: vi.fn().mockResolvedValue({
          installations: [],
          active_count: 0,
        }),
        listInstallationsAllWithWorkspace: vi.fn().mockResolvedValue([]),
        upsertRun: vi.fn(),
        insertAgentRun: vi.fn(),
        insertRunFindings: vi.fn(),
        updateSyncState: vi.fn(),
        listRuns: vi.fn().mockResolvedValue([]),
      },
      github: vi.fn(),
    } as unknown as Container;
  }

  it("does NOT call upsertInstallation when action=files", async () => {
    const upsertInstallation = vi.fn().mockResolvedValue(mockInstallRow);
    const container = makeMockContainer(upsertInstallation);
    const service = new CiService(container);

    const result = await service.exportCi(
      "agent-1",
      {
        repo: "owner/repo",
        target: "gha",
        action: "files",
        post_as: "github_review",
        triggers: ["opened", "synchronize"],
        base: "main",
      },
      "workspace-1",
    );

    expect(upsertInstallation).not.toHaveBeenCalled();
    expect(result.installation).toBeNull();
    expect(result.pr_url).toBeNull();
    expect(result.files.length).toBeGreaterThan(0);
  });

  it("calls upsertInstallation and opens PR when action=open_pr", async () => {
    const upsertInstallation = vi.fn().mockResolvedValue(mockInstallRow);
    const mockGh = {
      commitFiles: vi.fn().mockResolvedValue({ branch: "devdigest/ci" }),
      findOpenPr: vi.fn().mockResolvedValue(null),
      openPullRequest: vi
        .fn()
        .mockResolvedValue({ url: "https://github.com/owner/repo/pull/1" }),
    };
    const container = makeMockContainer(upsertInstallation);
    (container as any).github = vi.fn().mockResolvedValue(mockGh);

    const service = new CiService(container);
    const result = await service.exportCi(
      "agent-1",
      {
        repo: "owner/repo",
        target: "gha",
        action: "open_pr",
        post_as: "github_review",
        triggers: ["opened", "synchronize"],
        base: "main",
      },
      "workspace-1",
    );

    expect(upsertInstallation).toHaveBeenCalledOnce();
    expect(mockGh.commitFiles).toHaveBeenCalledOnce();
    expect(mockGh.openPullRequest).toHaveBeenCalledOnce();
    expect(result.installation).not.toBeNull();
    expect(result.pr_url).toBe("https://github.com/owner/repo/pull/1");
  });

  it("reuses existing open PR instead of opening a second one", async () => {
    const upsertInstallation = vi.fn().mockResolvedValue(mockInstallRow);
    const mockGh = {
      commitFiles: vi.fn().mockResolvedValue({ branch: "devdigest/ci" }),
      findOpenPr: vi
        .fn()
        .mockResolvedValue({ url: "https://github.com/owner/repo/pull/99" }),
      openPullRequest: vi.fn(),
    };
    const container = makeMockContainer(upsertInstallation);
    (container as any).github = vi.fn().mockResolvedValue(mockGh);

    const service = new CiService(container);
    const result = await service.exportCi(
      "agent-1",
      {
        repo: "owner/repo",
        target: "gha",
        action: "open_pr",
        post_as: "github_review",
        triggers: ["opened"],
        base: "main",
      },
      "workspace-1",
    );

    expect(mockGh.openPullRequest).not.toHaveBeenCalled();
    expect(result.pr_url).toBe("https://github.com/owner/repo/pull/99");
  });
});
