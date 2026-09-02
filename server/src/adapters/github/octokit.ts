import { Octokit } from "octokit";
import type {
  VcsClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  ListWorkflowRunsOptions,
  ListWorkflowRunsResult,
  WorkflowRun,
} from "@devdigest/shared";
import { withRetry, withTimeout } from "../../platform/resilience.js";

const TIMEOUT = 30_000;

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return "merged";
  if (state === "closed") return "closed";
  return "open";
}

/**
 * GitHub implementation of the `VcsClient` port, over Octokit REST — thin.
 * PAT auth (fine-grained). Reads PR list/detail/files/commits/issue; posts
 * reviews; opens PRs.
 */
export class OctokitGitHubClient implements VcsClient {
  readonly id = "github" as const;
  private octokit: Octokit;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    this.octokit = new Octokit({
      auth: token,
      request: {
        headers: {
          accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: "all",
            sort: "updated",
            direction: "desc",
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? "unknown",
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(
            repo,
            pr.body ?? "",
          );
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? "unknown",
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? "unknown",
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(
    repo: RepoRef,
    body: string,
  ): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  /**
   * Atomic batch-review path. No longer part of the `VcsClient` port (Azure
   * DevOps has no batch endpoint — see `publishComment`); kept private as an
   * implementation detail in case a future GitHub-specific caller wants the
   * atomic multi-comment behavior back.
   */
  private async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === "LEFT" ? "LEFT" : "RIGHT",
      body: c.body,
      user: c.user?.login ?? "unknown",
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
      // GitHub comments have no thread concept (Azure DevOps-only field).
      thread_id: null,
    };
  }

  async listReviewComments(
    repo: RepoRef,
    n: number,
  ): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res =
              await this.octokit.rest.pulls.createReplyForReviewComment({
                owner: repo.owner,
                repo: repo.name,
                pull_number: n,
                comment_id: input.inReplyTo,
                body: input.body,
              });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? "RIGHT",
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * `VcsClient.publishComment` for GitHub: there is no thread/idempotency
   * concept to layer on top, so this is a thin pass-through to the existing
   * inline-comment path.
   */
  async publishComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return this.createReviewComment(repo, n, input);
  }

  async editComment(_repo: RepoRef, _n: number, _threadId: number, _commentId: number, _body: string): Promise<void> {
    throw new Error("not_supported: editComment is not implemented for GitHub");
  }

  async deleteComment(_repo: RepoRef, _n: number, _threadId: number, _commentId: number): Promise<void> {
    throw new Error("not_supported: deleteComment is not implemented for GitHub");
  }

  async openPullRequest(
    repo: RepoRef,
    payload: OpenPrPayload,
  ): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const token = this.token;

          // Use raw fetch — Octokit sends application/vnd.github.v3+json which
          // GitHub rejects for fine-grained PATs on createTree. Direct fetch
          // with the correct Accept header works reliably.
          const headers = {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          };

          const gh = async (path: string, body: unknown) => {
            const r = await fetch(
              `https://api.github.com/repos/${owner}/${name}/${path}`,
              {
                method: "POST",
                headers,
                body: JSON.stringify(body),
              },
            );
            const json = (await r.json()) as Record<string, unknown>;
            if (!r.ok)
              throw new Error(
                `GitHub ${path} → ${r.status}: ${json.message as string}`,
              );
            return json;
          };

          const ghGet = async (path: string) => {
            const r = await fetch(
              `https://api.github.com/repos/${owner}/${name}/${path}`,
              { headers },
            );
            const json = (await r.json()) as Record<string, unknown>;
            if (!r.ok)
              throw new Error(
                `GitHub GET ${path} → ${r.status}: ${json.message as string}`,
              );
            return json;
          };

          const ghPatch = async (path: string, body: unknown) => {
            const r = await fetch(
              `https://api.github.com/repos/${owner}/${name}/${path}`,
              {
                method: "PATCH",
                headers,
                body: JSON.stringify(body),
              },
            );
            if (!r.ok) {
              const j = (await r.json()) as Record<string, unknown>;
              throw new Error(
                `GitHub PATCH ${path} → ${r.status}: ${j.message as string}`,
              );
            }
          };

          // 1. Parent commit: target branch if exists, else base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await ghGet(`git/ref/heads/${payload.branch}`);
            parentSha = (ref.object as { sha: string }).sha;
            branchExists = true;
          } catch {
            const baseRef = await ghGet(`git/ref/heads/${payload.base}`);
            parentSha = (baseRef.object as { sha: string }).sha;
          }

          // 2. Get base tree SHA from parent commit.
          const parentCommit = await ghGet(`git/commits/${parentSha}`);
          const baseTreeSha = (parentCommit.tree as { sha: string }).sha;

          // 3. Pre-create blobs for large files (>900 KB); inline the rest.
          const INLINE_LIMIT = 900_000;
          const treeEntries = await Promise.all(
            payload.files.map(async (f) => {
              const byteSize = Buffer.byteLength(f.contents, "utf8");
              if (byteSize > INLINE_LIMIT) {
                const blob = (await gh("git/blobs", {
                  content: Buffer.from(f.contents, "utf8").toString("base64"),
                  encoding: "base64",
                })) as { sha: string };
                return {
                  path: f.path,
                  mode: "100644",
                  type: "blob",
                  sha: blob.sha,
                };
              }
              return {
                path: f.path,
                mode: "100644",
                type: "blob",
                content: f.contents,
              };
            }),
          );

          // 4. Create tree.
          const tree = (await gh("git/trees", {
            base_tree: baseTreeSha,
            tree: treeEntries,
          })) as { sha: string };

          // 5. Create commit.
          const commit = (await gh("git/commits", {
            message: payload.message,
            tree: tree.sha,
            parents: [parentSha],
          })) as { sha: string };

          // 6. Update or create branch ref.
          if (branchExists) {
            await ghPatch(`git/refs/heads/${payload.branch}`, {
              sha: commit.sha,
              force: true,
            });
          } else {
            await gh("git/refs", {
              ref: `refs/heads/${payload.branch}`,
              sha: commit.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(
    repo: RepoRef,
    branch: string,
  ): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: "open",
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({
          owner: repo.owner,
          repo: repo.name,
          issue_number: n,
        }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }

  async getCommitActivity(
    repo: RepoRef,
    paths: string[],
    sinceDays: number,
  ): Promise<Record<string, number>> {
    const since = new Date(
      Date.now() - sinceDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result: Record<string, number> = {};

    await Promise.all(
      paths.map(async (path) => {
        try {
          const res = await withRetry(() =>
            withTimeout(
              this.octokit.rest.repos.listCommits({
                owner: repo.owner,
                repo: repo.name,
                path,
                since,
                per_page: 100,
              }),
              TIMEOUT,
            ),
          );
          result[path] = res.data.length;
        } catch {
          result[path] = 0;
        }
      }),
    );

    return result;
  }

  async listWorkflowRuns(
    repo: RepoRef,
    opts: ListWorkflowRunsOptions = {},
  ): Promise<ListWorkflowRunsResult> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          try {
            const res = opts.workflowFile
              ? await this.octokit.rest.actions.listWorkflowRuns({
                  owner: repo.owner,
                  repo: repo.name,
                  workflow_id: opts.workflowFile,
                  per_page: 30,
                  ...(opts.etag
                    ? { headers: { "if-none-match": opts.etag } }
                    : {}),
                })
              : await this.octokit.rest.actions.listWorkflowRunsForRepo({
                  owner: repo.owner,
                  repo: repo.name,
                  per_page: 30,
                  ...(opts.etag
                    ? { headers: { "if-none-match": opts.etag } }
                    : {}),
                });
            const etag =
              (res.headers.etag as string | undefined) ?? opts.etag ?? null;
            const runs = await Promise.all(
              res.data.workflow_runs.map(async (run) => {
                let artifacts: { id: number; name: string }[] = [];
                try {
                  const art =
                    await this.octokit.rest.actions.listWorkflowRunArtifacts({
                      owner: repo.owner,
                      repo: repo.name,
                      run_id: run.id,
                      per_page: 20,
                    });
                  artifacts = art.data.artifacts.map((a) => ({
                    id: a.id,
                    name: a.name,
                  }));
                } catch {
                  artifacts = [];
                }
                return {
                  id: run.id,
                  status: run.status ?? null,
                  conclusion: run.conclusion ?? null,
                  prNumber: run.pull_requests?.[0]?.number ?? null,
                  headSha: run.head_sha ?? null,
                  htmlUrl: run.html_url ?? null,
                  artifacts,
                } satisfies WorkflowRun;
              }),
            );
            return { notModified: false, etag, runs };
          } catch (err: unknown) {
            // Octokit surfaces a conditional-request 304 as a RequestError.
            if (
              err &&
              typeof err === "object" &&
              "status" in err &&
              (err as { status: number }).status === 304
            ) {
              return { notModified: true, etag: opts.etag ?? null, runs: [] };
            }
            throw err;
          }
        })(),
        TIMEOUT,
      ),
    );
  }

  async downloadArtifact(
    repo: RepoRef,
    artifactId: number | string,
  ): Promise<Buffer> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: Number(artifactId),
            archive_format: "zip",
          });
          return Buffer.from(res.data as ArrayBuffer);
        })(),
        TIMEOUT,
      ),
    );
  }
}
