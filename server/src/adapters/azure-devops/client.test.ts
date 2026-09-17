import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as GitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces.js";

/**
 * TASK-006 — hermetic unit tests for `AzureDevOpsClient`. No network calls:
 * the `azure-devops-node-api` module is mocked at the module boundary
 * (`WebApi.getGitApi()` resolves a fake `IGitApi`). Field shapes mirror the
 * REAL response documented in TASK-000's spike
 * (`__fixtures__/pr-6327-iteration-changes-shape.json`,
 * `SPIKE-NOTES.md` §2) — numeric `status`/`changeType` enums, not strings;
 * `nextTop`/`nextSkip` OMITTED (not `0`) on the last page.
 */

const fakeGitApi = {
  getPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
  getPullRequestIterations: vi.fn(),
  getPullRequestIterationChanges: vi.fn(),
  getPullRequestCommits: vi.fn(),
};

const webApiCtor = vi.fn();

vi.mock("azure-devops-node-api", () => ({
  WebApi: class {
    constructor(...args: unknown[]) {
      webApiCtor(...args);
    }
    async getGitApi() {
      return fakeGitApi;
    }
  },
  getPersonalAccessTokenHandler: vi.fn((token: string) => ({ token })),
}));

const { AzureDevOpsClient } = await import("./client.js");

const REPO = { owner: "GES-IT", name: "ges-azure-functions", project: "Big_Commerce_Remediation" };

function realPrFixture(overrides: Partial<GitInterfaces.GitPullRequest> = {}): GitInterfaces.GitPullRequest {
  return {
    pullRequestId: 6327,
    title: "Fix rate limiter",
    createdBy: { displayName: "Marisa Koch", uniqueName: "marisa@ges-it.example" },
    sourceRefName: "refs/heads/feat/rate-limit",
    targetRefName: "refs/heads/main",
    lastMergeSourceCommit: { commitId: "6befee467ec97ee18055cf13ec26ed1e996e1ea9" },
    status: 1 /* GitInterfaces.PullRequestStatus.Active — numeric, confirmed via spike */,
    creationDate: new Date("2026-08-01T00:00:00Z"),
    description: "Closes #12",
    ...overrides,
  } as GitInterfaces.GitPullRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  // TASK-009 — `gitApiFor` now runs a one-time `fetch`-based preflight
  // (`verifyAdoConnection`, see client.ts) before trusting the SDK
  // connection. Stub it to a healthy JSON 200 by default so pre-existing
  // TASK-006/007 tests (which know nothing about this) stay hermetic;
  // `client.retry.test.ts` overrides this per-test to exercise the guard.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

describe("AzureDevOpsClient — mapping (AC-006-1)", () => {
  it("maps a real-shaped PR to PrMeta with numeric status → open/merged/closed", async () => {
    fakeGitApi.getPullRequests.mockResolvedValue([
      realPrFixture({ status: 1 }),
      realPrFixture({ pullRequestId: 6328, status: 3 /* Completed */ }),
      realPrFixture({ pullRequestId: 6329, status: 2 /* Abandoned */ }),
    ]);

    const client = new AzureDevOpsClient("pat");
    const prs = await client.listPullRequests(REPO);

    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({
      number: 6327,
      title: "Fix rate limiter",
      author: "Marisa Koch",
      branch: "feat/rate-limit",
      base: "main",
      head_sha: "6befee467ec97ee18055cf13ec26ed1e996e1ea9",
      status: "open",
    });
    expect(prs[1]!.status).toBe("merged");
    expect(prs[2]!.status).toBe("closed");
  });

  it("strips the leading slash ADO's item.path always carries, so it matches git diff's path convention", async () => {
    fakeGitApi.getPullRequest.mockResolvedValue(realPrFixture());
    fakeGitApi.getPullRequestIterations.mockResolvedValue([{ id: 1 }]);
    fakeGitApi.getPullRequestCommits.mockResolvedValue([]);
    fakeGitApi.getPullRequestIterationChanges.mockResolvedValue({
      changeEntries: [
        { changeTrackingId: 1, changeId: 1, changeType: 1, item: { path: "/apps/order-functions/health.ts" } },
      ],
    });
    const client = new AzureDevOpsClient("pat");
    const detail = await client.getPullRequest(REPO, 6327);
    expect(detail.files[0]!.path).toBe("apps/order-functions/health.ts");
    expect(detail.files[0]!.path.startsWith("/")).toBe(false);
  });

  it("AC-006-2: additions/deletions/files_count are 0 on the list payload", async () => {
    fakeGitApi.getPullRequests.mockResolvedValue([realPrFixture()]);
    const client = new AzureDevOpsClient("pat");
    const [pr] = await client.listPullRequests(REPO);
    expect(pr).toMatchObject({ additions: 0, deletions: 0, files_count: 0 });
  });

  it("getPullRequest backfills real files_count and leaves patch null (filled by TASK-007)", async () => {
    fakeGitApi.getPullRequest.mockResolvedValue(realPrFixture());
    fakeGitApi.getPullRequestIterations.mockResolvedValue([{ id: 9 }]);
    fakeGitApi.getPullRequestIterationChanges.mockResolvedValue({
      // Real ADO `item.path` carries a leading slash (confirmed against the
      // real API) — the mapper must strip it so it matches `git diff`'s
      // leading-slash-free `+++ b/path` lines (TASK-007's overlay match).
      changeEntries: [
        { changeTrackingId: 1, changeId: 1, changeType: 1 /* Add */, item: { path: "/src/a.ts", objectId: "x" } },
        {
          changeTrackingId: 2,
          changeId: 2,
          changeType: 2 /* Edit */,
          item: { path: "/src/b.ts", objectId: "y", originalObjectId: "z" },
        },
      ],
      // no nextTop/nextSkip — last page (TASK-000 finding).
    });
    fakeGitApi.getPullRequestCommits.mockResolvedValue([
      { commitId: "abc123", comment: "fix", author: { name: "marisa.koch", date: new Date("2026-08-01T00:00:00Z") } },
    ]);

    const client = new AzureDevOpsClient("pat");
    const detail = await client.getPullRequest(REPO, 6327);

    expect(detail.files_count).toBe(2);
    expect(detail.files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    for (const f of detail.files) {
      expect(f.patch).toBeNull();
    }
    expect(detail.commits).toHaveLength(1);
    expect(detail.commits[0]).toMatchObject({ sha: "abc123", author: "marisa.koch" });
  });

  it("AC-006-6 / R23: linked_issue is never set for ADO even when body contains 'Closes #N'", async () => {
    fakeGitApi.getPullRequest.mockResolvedValue(realPrFixture({ description: "Closes #12" }));
    fakeGitApi.getPullRequestIterations.mockResolvedValue([]);
    fakeGitApi.getPullRequestCommits.mockResolvedValue([]);

    const client = new AzureDevOpsClient("pat");
    const detail = await client.getPullRequest(REPO, 6327);
    expect(detail.linked_issue).toBeUndefined();
  });
});

describe("AzureDevOpsClient — pagination (AC-006-3)", () => {
  it("follows nextSkip across pages and stops when nextSkip is absent (not 0)", async () => {
    fakeGitApi.getPullRequest.mockResolvedValue(realPrFixture());
    fakeGitApi.getPullRequestIterations.mockResolvedValue([{ id: 3 }]);
    fakeGitApi.getPullRequestCommits.mockResolvedValue([]);

    const page1Entries = Array.from({ length: 2000 }, (_, i) => ({
      changeTrackingId: i + 1,
      changeId: i + 1,
      changeType: 1,
      item: { path: `/src/file-${i}.ts`, objectId: "x" },
    }));
    const page2Entries = Array.from({ length: 500 }, (_, i) => ({
      changeTrackingId: 2000 + i + 1,
      changeId: 2000 + i + 1,
      changeType: 1,
      item: { path: `/src/file-${2000 + i}.ts`, objectId: "x" },
    }));

    fakeGitApi.getPullRequestIterationChanges
      .mockResolvedValueOnce({ changeEntries: page1Entries, nextSkip: 2000, nextTop: 2000 })
      .mockResolvedValueOnce({ changeEntries: page2Entries /* no nextSkip/nextTop — last page */ });

    const client = new AzureDevOpsClient("pat");
    const detail = await client.getPullRequest(REPO, 6327);

    expect(detail.files_count).toBe(2500);
    expect(fakeGitApi.getPullRequestIterationChanges).toHaveBeenCalledTimes(2);
    expect(fakeGitApi.getPullRequestIterationChanges).toHaveBeenNthCalledWith(
      2,
      REPO.name,
      6327,
      3,
      REPO.project,
      2000,
      2000,
    );
  });

  it("a loop written as `nextSkip !== 0` would misbehave — this client uses a falsy check instead", async () => {
    // Regression guard for the TASK-000 gotcha: a single page with NO
    // nextSkip/nextTop keys must terminate after exactly one call.
    fakeGitApi.getPullRequest.mockResolvedValue(realPrFixture());
    fakeGitApi.getPullRequestIterations.mockResolvedValue([{ id: 9 }]);
    fakeGitApi.getPullRequestCommits.mockResolvedValue([]);
    fakeGitApi.getPullRequestIterationChanges.mockResolvedValue({
      changeEntries: [{ changeTrackingId: 1, changeId: 1, changeType: 1, item: { path: "/x.ts" } }],
    });

    const client = new AzureDevOpsClient("pat");
    await client.getPullRequest(REPO, 6327);
    expect(fakeGitApi.getPullRequestIterationChanges).toHaveBeenCalledTimes(1);
  });
});

describe("AzureDevOpsClient — guard clauses & not_supported (R11/R12)", () => {
  it("AC-006-4: listPullRequests without `project` throws a configuration error BEFORE any network call", async () => {
    const client = new AzureDevOpsClient("pat");
    await expect(client.listPullRequests({ owner: "acme", name: "api" })).rejects.toThrow(/project/i);
    expect(webApiCtor).not.toHaveBeenCalled();
    expect(fakeGitApi.getPullRequests).not.toHaveBeenCalled();
  });

  it("AC-006-4: getPullRequest without `project` throws a configuration error BEFORE any network call", async () => {
    const client = new AzureDevOpsClient("pat");
    await expect(client.getPullRequest({ owner: "acme", name: "api" }, 1)).rejects.toThrow(/project/i);
    expect(webApiCtor).not.toHaveBeenCalled();
  });

  it("AC-006-5: listWorkflowRuns throws not_supported naming the provider and method", async () => {
    const client = new AzureDevOpsClient("pat");
    await expect(client.listWorkflowRuns(REPO)).rejects.toThrow(/azure-devops.*listWorkflowRuns/);
  });

  it("write/CI/work-item methods all throw not_supported, never a silent empty success", async () => {
    const client = new AzureDevOpsClient("pat");
    await expect(client.openPullRequest(REPO, { title: "t", head: "h", base: "b", body: "" })).rejects.toThrow(
      /azure-devops.*openPullRequest/,
    );
    await expect(client.commitFiles(REPO, { branch: "b", base: "main", message: "m", files: [] })).rejects.toThrow(
      /azure-devops.*commitFiles/,
    );
    await expect(client.findOpenPr(REPO, "branch")).rejects.toThrow(/azure-devops.*findOpenPr/);
    await expect(client.getIssue(REPO, 1)).rejects.toThrow(/azure-devops.*getIssue/);
    await expect(client.downloadArtifact(REPO, 1)).rejects.toThrow(/azure-devops.*downloadArtifact/);
  });
});

describe("AzureDevOpsClient — org-scoped connection caching", () => {
  it("reuses the same WebApi connection for repeated calls to the same {baseUrl, org}", async () => {
    fakeGitApi.getPullRequests.mockResolvedValue([]);
    const client = new AzureDevOpsClient("pat");
    await client.listPullRequests(REPO);
    await client.listPullRequests(REPO);
    expect(webApiCtor).toHaveBeenCalledTimes(1);
  });

  it("builds a distinct connection per org (repo.owner)", async () => {
    fakeGitApi.getPullRequests.mockResolvedValue([]);
    const client = new AzureDevOpsClient("pat");
    await client.listPullRequests(REPO);
    await client.listPullRequests({ ...REPO, owner: "other-org" });
    expect(webApiCtor).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// TASK-009 — resilience wiring: preflight (R48) + rate-limit logging (R45).
// ---------------------------------------------------------------------------

describe("AzureDevOpsClient — connection preflight (AC-009-5)", () => {
  it("a 2xx HTML sign-in-page response (no real error status) is rejected as vcs_unauthorized, not treated as a healthy connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>sign in</html>", { status: 203, headers: { "content-type": "text/html" } }),
      ),
    );
    const client = new AzureDevOpsClient("pat");
    await expect(client.listPullRequests(REPO)).rejects.toMatchObject({
      code: "vcs_unauthorized",
      statusCode: 401,
    });
    // The typed SDK call must never even be reached once preflight rejects.
    expect(fakeGitApi.getPullRequests).not.toHaveBeenCalled();
  });

  it("preflight itself returning 401/403 is also mapped to vcs_unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const client = new AzureDevOpsClient("pat");
    await expect(client.listPullRequests(REPO)).rejects.toMatchObject({
      code: "vcs_unauthorized",
      statusCode: 401,
    });
  });

  it("preflight passes and the real call proceeds for a healthy JSON 200", async () => {
    fakeGitApi.getPullRequests.mockResolvedValue([]);
    const client = new AzureDevOpsClient("pat");
    await expect(client.listPullRequests(REPO)).resolves.toEqual([]);
  });
});

describe("AzureDevOpsClient — rate-limit logging (AC-009-2)", () => {
  it("logs remaining/delay from a rate-limited SDK error without ever logging the PAT", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fakeGitApi.getPullRequests.mockRejectedValue(
        Object.assign(new Error("rate limited"), {
          statusCode: 429,
          rateLimit: { remaining: 0, delay: 1 },
        }),
      );
      const client = new AzureDevOpsClient("super-secret-pat-value");
      const promise = client.listPullRequests(REPO).catch((e) => e);
      for (let i = 0; i < 5; i++) {
        await vi.runOnlyPendingTimersAsync();
      }
      const result = await promise;
      expect(result).toMatchObject({ code: "vcs_rate_limited" });

      expect(warnSpy).toHaveBeenCalled();
      const serialized = JSON.stringify(warnSpy.mock.calls);
      expect(serialized).not.toContain("super-secret-pat-value");
      expect(serialized).toContain("remaining");
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
