import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import * as GitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type {
  VcsClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrReviewComment,
  CreateReviewCommentInput,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  ListWorkflowRunsOptions,
  ListWorkflowRunsResult,
} from "@devdigest/shared";
import { ConfigError } from "../../platform/errors.js";
import { AZURE_DEVOPS_DEFAULT_BASE_URL, MAX_ITERATION_CHANGES_PAGE, notSupported } from "./constants.js";
import {
  mapPullRequestToMeta,
  mapPullRequestToDetail,
  mapChangeEntryToFile,
  mapCommit,
  type MappedChangeEntry,
} from "./mappers.js";
import { publishThreadComment, listThreadComments, updateThreadComment, deleteThreadComment, type ThreadRepoContext } from "./threads.js";
import { assertJsonResponse, mapAdoAuthError } from "./errors.js";
import { withAdoRetry } from "./retry.js";

/**
 * TASK-009/R48 — one-time, per-org sanity check run BEFORE the SDK connection
 * is trusted: hits the lightweight `_apis/connectionData` endpoint directly
 * (bypassing the SDK) so the raw status/content-type are visible. A typed
 * `IGitApi` call can never see this — see errors.ts's `assertJsonResponse`
 * doc for why. `connectionData` needs no `vso.code*` scope, only a valid
 * identity, so a 401/403 here means "PAT is not valid at all" specifically.
 */
async function verifyAdoConnection(orgUrl: string, token: string): Promise<void> {
  const res = await fetch(`${orgUrl}/_apis/connectionData?api-version=7.1`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw mapAdoAuthError({ statusCode: res.status });
  }
  assertJsonResponse(res.status, res.headers.get("content-type"));
}

/**
 * TASK-009/R46 — transparently retries and error-translates every `IGitApi`
 * method call (both this file's and threads.ts's, since both consume the
 * `IGitApi` this returns) without touching either call site: a `Proxy`
 * intercepts every method, running it through `withAdoRetry`. GitHub's
 * client is a completely separate class and is untouched by this (AC-009-3).
 */
function wrapGitApiWithResilience(gitApi: IGitApi): IGitApi {
  return new Proxy(gitApi, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        withAdoRetry(
          () => (value as (...a: unknown[]) => unknown).apply(target, args) as Promise<unknown>,
          String(prop),
        );
    },
  }) as IGitApi;
}

/**
 * TASK-006 — Azure DevOps implementation of the `VcsClient` port, over the
 * official `azure-devops-node-api` SDK (Q1/R-E of the plan — NOT a hand-rolled
 * REST client).
 *
 * Construction takes only the workspace-level PAT (Q3 — a single
 * `AZURE_DEVOPS_TOKEN` per workspace, mirroring `GITHUB_TOKEN`). Unlike
 * `OctokitGitHubClient` (whose single `api.github.com` host never varies),
 * Azure DevOps' connection is scoped to one `{baseUrl}/{org}` at a time — and
 * a single workspace can have repos in different orgs/self-hosted servers
 * (`RepoRef.baseUrl`/`RepoRef.owner` differ per call). `Container.vcs()`
 * caches ONE `AzureDevOpsClient` per provider (not per repo), so the
 * org-scoped `IGitApi` connection is built lazily per call and cached here,
 * keyed by the resolved `{baseUrl}/{org}` — not at construction time.
 */
export class AzureDevOpsClient implements VcsClient {
  readonly id = "azure-devops" as const;
  private readonly gitApiCache = new Map<string, Promise<IGitApi>>();

  constructor(private readonly token: string) {}

  private gitApiFor(repo: RepoRef): Promise<IGitApi> {
    const baseUrl = (repo.baseUrl ?? AZURE_DEVOPS_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const orgUrl = `${baseUrl}/${encodeURIComponent(repo.owner)}`;
    const cached = this.gitApiCache.get(orgUrl);
    if (cached) return cached;
    const promise = (async () => {
      // Preflight runs once per org and is cached alongside the connection
      // itself — it is not repeated on every subsequent call through this
      // client (see verifyAdoConnection's doc for why it exists at all).
      await withAdoRetry(() => verifyAdoConnection(orgUrl, this.token), `connection check (${orgUrl})`);
      const authHandler = getPersonalAccessTokenHandler(this.token);
      const connection = new WebApi(orgUrl, authHandler);
      const gitApi = await connection.getGitApi();
      return wrapGitApiWithResilience(gitApi);
    })();
    this.gitApiCache.set(orgUrl, promise);
    return promise;
  }

  /**
   * Domain-invariant guard (R11/AC-006-4): an Azure DevOps `RepoRef` without
   * `project` cannot address a repo (`{org}/{project}/{repo}`) — this is a
   * plain `if`, not Zod (see Architecture Notes — validation stack: HTTP-shape
   * rules are Zod, domain invariants are guard-clauses in the adapter). Thrown
   * BEFORE any network call — `gitApiFor` is not called first.
   */
  private requireProject(repo: RepoRef): string {
    if (!repo.project) {
      throw new ConfigError(
        `Azure DevOps repo ref for '${repo.owner}/${repo.name}' is missing 'project' — cannot address {org}/{project}/{repo}`,
      );
    }
    return repo.project;
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    const project = this.requireProject(repo);
    const gitApi = await this.gitApiFor(repo);
    const prs = await gitApi.getPullRequests(
      repo.name,
      { status: GitInterfaces.PullRequestStatus.All },
      project,
      undefined,
      0,
      50,
    );
    return prs.map(mapPullRequestToMeta);
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    const project = this.requireProject(repo);
    const gitApi = await this.gitApiFor(repo);
    const pr = await gitApi.getPullRequest(repo.name, n, project);
    const [files, commits] = await Promise.all([
      this.listChangedFiles(gitApi, repo.name, n, project),
      this.listCommits(gitApi, repo.name, n, project),
    ]);
    return mapPullRequestToDetail(pr, files, commits);
  }

  /**
   * `iterations/{latestIterationId}/changes`, paginated at `$top=2000`
   * (R21/AC-006-3). CRITICAL gotcha confirmed by TASK-000's spike
   * (`SPIKE-NOTES.md §2a`): when there is no further page, the SDK OMITS
   * `nextTop`/`nextSkip` entirely (`undefined`) rather than setting them to
   * `0`. A `while (nextSkip !== 0)` loop would treat `undefined !== 0` as
   * "more pages" and misbehave — the falsy check below (`while (page.nextSkip)`)
   * is required.
   */
  private async listChangedFiles(
    gitApi: IGitApi,
    repositoryId: string,
    pullRequestId: number,
    project: string,
  ): Promise<MappedChangeEntry[]> {
    const iterations = await gitApi.getPullRequestIterations(repositoryId, pullRequestId, project);
    const latest = iterations[iterations.length - 1];
    if (latest?.id == null) return [];

    const out: MappedChangeEntry[] = [];
    let skip = 0;
    for (;;) {
      const page = await gitApi.getPullRequestIterationChanges(
        repositoryId,
        pullRequestId,
        latest.id,
        project,
        MAX_ITERATION_CHANGES_PAGE,
        skip,
      );
      for (const entry of page.changeEntries ?? []) {
        out.push(mapChangeEntryToFile(entry));
      }
      if (!page.nextSkip) break;
      skip = page.nextSkip;
    }
    return out;
  }

  private async listCommits(
    gitApi: IGitApi,
    repositoryId: string,
    pullRequestId: number,
    project: string,
  ) {
    const commits = await gitApi.getPullRequestCommits(repositoryId, pullRequestId, project);
    return commits.map(mapCommit);
  }

  // ---- Comment/thread publishing — TASK-008 -------------------------------
  // Real logic lives in `threads.ts` (idempotent create-or-update via
  // `properties['devdigest.findingId']`, `pullRequestThreadContext`
  // positioning). This class only resolves the shared `ThreadRepoContext`
  // (git API handle, project, and the current iteration's per-path
  // `changeTrackingId` map) and delegates.

  /**
   * `changeTrackingId` per changed path, for the LATEST iteration — reuses
   * the same `listChangedFiles` call the read path (TASK-006/007) already
   * makes, so this costs one extra network round trip per publish, not a
   * second pagination implementation.
   */
  private async threadContextFor(repo: RepoRef, n: number): Promise<ThreadRepoContext> {
    const project = this.requireProject(repo);
    const gitApi = await this.gitApiFor(repo);
    const files = await this.listChangedFiles(gitApi, repo.name, n, project);
    const changeTrackingIdByPath: Record<string, number> = {};
    for (const f of files) {
      if (f.changeTrackingId != null) {
        const p = f.path.startsWith("/") ? f.path : `/${f.path}`;
        changeTrackingIdByPath[p] = f.changeTrackingId;
      }
    }
    return {
      git: gitApi,
      repositoryId: repo.name,
      project,
      pullRequestId: n,
      repo: { owner: repo.owner, name: repo.name, project: repo.project, baseUrl: repo.baseUrl },
      baseUrl: (repo.baseUrl ?? AZURE_DEVOPS_DEFAULT_BASE_URL).replace(/\/+$/, ""),
      changeTrackingIdByPath,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    const project = this.requireProject(repo);
    const gitApi = await this.gitApiFor(repo);
    return listThreadComments({
      git: gitApi,
      repositoryId: repo.name,
      project,
      pullRequestId: n,
      repo: { owner: repo.owner, name: repo.name, project: repo.project, baseUrl: repo.baseUrl },
      baseUrl: (repo.baseUrl ?? AZURE_DEVOPS_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    });
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    // ADO has no separate "inline comment vs. idempotent finding" API —
    // both ports converge on the same thread logic (R40: no atomic batch
    // path exists here either way).
    return this.publishComment(repo, n, input);
  }

  async publishComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    const ctx = await this.threadContextFor(repo, n);
    return publishThreadComment(ctx, input);
  }

  async editComment(
    repo: RepoRef,
    n: number,
    threadId: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    const ctx = await this.threadContextFor(repo, n);
    await updateThreadComment(ctx, threadId, commentId, body);
  }

  async deleteComment(
    repo: RepoRef,
    n: number,
    threadId: number,
    commentId: number,
  ): Promise<void> {
    const ctx = await this.threadContextFor(repo, n);
    await deleteThreadComment(ctx, threadId, commentId);
  }

  // ---- Explicitly unsupported (R12/AC-006-5) — write/CI/Work-Item paths ---
  async openPullRequest(_repo: RepoRef, _payload: OpenPrPayload): Promise<{ url: string }> {
    throw notSupported(this.id, "openPullRequest");
  }

  async commitFiles(_repo: RepoRef, _payload: CommitFilesPayload): Promise<{ branch: string }> {
    throw notSupported(this.id, "commitFiles");
  }

  async findOpenPr(_repo: RepoRef, _branch: string): Promise<{ url: string } | null> {
    throw notSupported(this.id, "findOpenPr");
  }

  async getIssue(_repo: RepoRef, _n: number): Promise<IssueMeta> {
    throw notSupported(this.id, "getIssue");
  }

  async currentLogin(): Promise<string> {
    throw notSupported(this.id, "currentLogin");
  }

  async getCommitActivity(
    _repo: RepoRef,
    paths: string[],
    _sinceDays: number,
  ): Promise<Record<string, number>> {
    // Degrades to 0 for every path — every existing caller (onboarding hotness)
    // already wraps this call in try/catch and treats a thrown error as
    // hotness=0 (see `server/insights/INSIGHTS.md`), so `not_supported` here
    // is equivalent in effect to computing real per-path commit counts via a
    // much more expensive ADO `getCommits` call per path — not worth the cost
    // for a "nice to have" hotness signal.
    throw notSupported(this.id, "getCommitActivity");
  }

  async listWorkflowRuns(
    _repo: RepoRef,
    _opts?: ListWorkflowRunsOptions,
  ): Promise<ListWorkflowRunsResult> {
    throw notSupported(this.id, "listWorkflowRuns");
  }

  async downloadArtifact(_repo: RepoRef, _artifactId: number | string): Promise<Buffer> {
    throw notSupported(this.id, "downloadArtifact");
  }
}
