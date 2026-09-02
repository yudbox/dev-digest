import { z } from 'zod';
import type {
  PrMeta,
  PrDetail,
  IssueMeta,
  PrReviewComment,
  VcsProvider,
} from './contracts/platform.js';

/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `apps/api/src/adapters/*`; mock implementations
 * live alongside for tests/dev (Services depend on the interface, not the impl).
 */

// ---------- LLM ----------
export const ModelInfo = z.object({
  id: z.string(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  label: z.string().nullish(),
  created: z.number().int().nullish(),
  /** Pricing in USD per 1M tokens (when the provider exposes it, e.g. OpenRouter). */
  pricing: z
    .object({ promptPerM: z.number(), completionPerM: z.number() })
    .nullish(),
  /** Max context window in tokens (when the provider exposes it). */
  contextLength: z.number().int().nullish(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Structured-output request. `schema` is a Zod schema; `schemaName` names the
 * tool / json_schema. `maxRetries` controls reprompt-on-error.
 */
export interface StructuredRequest<T> {
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * OpenRouter session id — groups related generations (e.g. all map-reduce
   * chunks of one review) into a session in the OpenRouter dashboard. Sent as
   * the `session_id` body field; ignored by providers that don't support it.
   */
  sessionId?: string;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  raw: string;
  attempts: number;
}

export interface LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter';
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- Embedder ----------
export interface Embedder {
  /** OpenAI text-embedding-3-small → 1536 dims. */
  embed(texts: string[]): Promise<number[][]>;
  readonly dims: number;
}

// ---------- VCS (GitHub via Octokit REST / Azure DevOps via SDK) ----------
export interface RepoRef {
  owner: string;
  name: string;
  /** Azure DevOps only: middle segment of the org/project/repo triple. Ignored by GitHub. */
  project?: string;
  /** Azure DevOps only: hosting base URL (e.g. `https://dev.azure.com`, or a self-hosted server). Ignored by GitHub. */
  baseUrl?: string;
}

export interface GitHubReviewPayload {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: { path: string; line: number; body: string }[];
}

/** Create one standalone inline review comment (or a reply to a thread). */
export interface CreateReviewCommentInput {
  /** Head commit the comment pins to (GitHub requires commit_id). */
  commitId: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
  /** When set, post as a reply to that comment's thread instead of a new one. */
  inReplyTo?: number;
  /**
   * TASK-008 (SPEC-2026-08-25-azure-devops-integration, R32): the finding's
   * severity and title, used ONLY by the Azure DevOps implementation to
   * derive a stable `findingId` for idempotent thread publishing (R33) —
   * hashing on `body` instead would break idempotency the moment a finding's
   * wording is regenerated slightly on a re-run, since `body` is exactly the
   * text that is expected to vary. GitHub's `publishComment`/
   * `createReviewComment` ignore both fields entirely.
   */
  severity?: string;
  title?: string;
}

export interface OpenPrPayload {
  title: string;
  head: string;
  base: string;
  body: string;
}

/** A single file to write in a commit (path relative to repo root + UTF-8 text). */
export interface CommitFile {
  path: string;
  contents: string;
}

export interface CommitFilesPayload {
  /** Branch to create-or-update with the commit (e.g. "devdigest/ci"). */
  branch: string;
  /** Base branch to fork from when `branch` does not yet exist (e.g. "main"). */
  base: string;
  message: string;
  files: CommitFile[];
}

/** A reference to one uploaded artifact of a workflow run. */
export interface WorkflowRunArtifact {
  id: number;
  name: string;
}

/**
 * One GitHub Actions workflow run, thinned to what CI ingest needs. `status`
 * is the run's lifecycle (`queued`/`in_progress`/`completed`); `conclusion` is
 * the outcome once completed (`success`/`failure`/…, null while running).
 */
export interface WorkflowRun {
  id: number;
  status: string | null;
  conclusion: string | null;
  prNumber: number | null;
  headSha: string | null;
  htmlUrl: string | null;
  artifacts: WorkflowRunArtifact[];
}

/** Options for a conditional `listWorkflowRuns` (If-None-Match). */
export interface ListWorkflowRunsOptions {
  /** Workflow file name to scope to (e.g. "devdigest-review.yml"). */
  workflowFile?: string;
  /** Stored ETag for a conditional request; 304 → `notModified`. */
  etag?: string | null;
}

/** Result of `listWorkflowRuns` — either a 304 no-op or fresh runs + new ETag. */
export interface ListWorkflowRunsResult {
  notModified: boolean;
  etag: string | null;
  runs: WorkflowRun[];
}

/**
 * VCS port — a discriminated multi-provider port, following the same pattern
 * as `LLMProvider` (`readonly id: 'openai' | 'anthropic' | 'openrouter'`).
 * `readonly id` lets `Container.vcs(repo)` dispatch the concrete
 * implementation by `repo.vcsProvider` at runtime — a plain rename from
 * `GitHubClient` would give no such discriminator.
 *
 * Not every method is meaningful for every provider (e.g. `listWorkflowRuns`
 * has no Azure DevOps analogue — Azure Pipelines is out of scope). A provider
 * that cannot support a method must throw an explicit `not_supported` error
 * naming its `id` and the method — never a silent empty success.
 */
export interface VcsClient {
  readonly id: VcsProvider;
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequest(repo: RepoRef, n: number): Promise<PrDetail>;
  /** List inline review comments on a PR (for the "Files changed" tab). */
  listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]>;
  /** Create one inline review comment (or reply) on a PR; returns the new comment. */
  createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment>;
  /**
   * Publish one review comment, letting the implementation choose its native
   * strategy (GitHub: an inline review comment via the same path as
   * `createReviewComment`; Azure DevOps: idempotent thread create/update
   * matched on a stable finding id). Replaces the old GitHub-only atomic
   * batch `postReview` — Azure DevOps has no batch endpoint, so publishing is
   * always one comment per call for both providers.
   */
  publishComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment>;
  /**
   * Edit the body of a previously published comment. Provider implementations
   * that do not support editing throw `not_supported`.
   */
  editComment(
    repo: RepoRef,
    n: number,
    threadId: number,
    commentId: number,
    body: string,
  ): Promise<void>;
  /**
   * Delete a previously published comment. Provider implementations that do
   * not support deletion throw `not_supported`.
   */
  deleteComment(
    repo: RepoRef,
    n: number,
    threadId: number,
    commentId: number,
  ): Promise<void>;
  openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }>;
  /**
   * Commit `files` onto `branch` as ONE atomic commit (Git Data API: blobs →
   * tree → commit → ref). Creates the branch from `base` if missing, else
   * fast-forwards it. Idempotent: re-publishing just adds a new commit.
   */
  commitFiles(repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }>;
  /** The open PR whose head is `branch`, if any (so re-publish reuses it). */
  findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null>;
  getIssue(repo: RepoRef, n: number): Promise<IssueMeta>;
  /** GET /user — for "posting as @user". */
  currentLogin(): Promise<string>;
  /**
   * Returns commit count per path in the last `sinceDays` days.
   * Degrades gracefully: the service layer catches errors and falls back to hotness=0.
   */
  getCommitActivity(repo: RepoRef, paths: string[], sinceDays: number): Promise<Record<string, number>>;
  /**
   * List completed+in-flight workflow runs for a repo (thin), supporting a
   * conditional (`If-None-Match`) request via `opts.etag`. On 304 returns
   * `{ notModified: true, runs: [], etag }`; on 200 returns fresh runs + the
   * new ETag. CI ingest uses this to pull only changed runs.
   */
  listWorkflowRuns(repo: RepoRef, opts?: ListWorkflowRunsOptions): Promise<ListWorkflowRunsResult>;
  /** Download one workflow-run artifact as a raw zip Buffer (caller unzips). */
  downloadArtifact(repo: RepoRef, artifactId: number | string): Promise<Buffer>;
}

/**
 * @deprecated Use `VcsClient`. Kept as a type alias so pre-existing imports
 * of `GitHubClient` keep compiling while call sites migrate to `VcsClient`
 * (see TASK-002 of SPEC-2026-08-25-azure-devops-integration).
 */
export type GitHubClient = VcsClient;

// ---------- Git (simple-git, heavy) ----------
export interface CloneOptions {
  depth?: number;
  branch?: string;
}

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines present in the *new* file covered by this hunk (for grounding). */
  newLineNumbers: number[];
}

export interface UnifiedDiff {
  raw: string;
  files: { path: string; additions: number; deletions: number; hunks: DiffHunk[] }[];
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitClient {
  clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }>;
  /**
   * Fetch the PR's head (and, for providers where it comes bundled, base)
   * commit into the local clone. Refspec is provider-specific: GitHub exposes
   * `pull/<n>/head` directly; Azure DevOps has no such ref — `refs/pull/<n>/merge`
   * is the confirmed working refspec there (TASK-000 spike,
   * `adapters/azure-devops/SPIKE-NOTES.md` — a single fetch of that ref also
   * brings the base commit along for free, since ADO's auto-generated merge
   * commit's two parents are exactly the target/source commits). `repo.provider`
   * is optional and defaults to `'github'` so every pre-existing `RepoRef`
   * (which never set it) keeps today's exact behavior. `url`, when given, is
   * an authenticated clone URL used ONLY for this one fetch call (never
   * persisted) — required for Azure DevOps, whose `origin` remote is never
   * allowed to carry embedded credentials (AC-005-1); ignored by GitHub,
   * whose `origin` remote already carries the token from the original clone.
   *
   * Returns the local `pr-{n}` ref's resolved head sha (for Azure DevOps,
   * the merge commit's SECOND parent — the real PR head, not the synthetic
   * merge commit itself) — the caller's single source of truth for "what
   * commit did we actually just fetch and diff against", so a diff/review
   * never silently falls back to a possibly-stale persisted `head_sha`.
   */
  fetchPullHead(repo: RepoRef & { provider?: VcsProvider }, n: number, url?: string): Promise<string>;
  /**
   * Resync an already-cloned repo to the tip of `branch`: fetch from origin and
   * advance the local working tree to `origin/<branch>`. Unlike `clone`'s bare
   * `fetch` (which only moves remote-tracking refs), this moves local HEAD so a
   * subsequent index reflects the latest code. Returns the new HEAD sha.
   */
  sync(repo: RepoRef, branch: string): Promise<{ head: string }>;
  currentHead(repo: RepoRef): Promise<string>;
  diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff>;
  /**
   * Names of files changed between two commits (`git diff --name-only base..head`).
   * Two-dot form is intentional — we want files reachable from `head` but not `base`,
   * matching the incremental indexer's "what moved since last_indexed_sha?" semantics.
   * Returns an empty array when the two refs resolve to the same commit.
   */
  diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]>;
  blame(repo: RepoRef, path: string): Promise<BlameLine[]>;
  log(repo: RepoRef, path?: string): Promise<GitCommit[]>;
  readFile(repo: RepoRef, path: string): Promise<string>;
  /**
   * Local clone directory for `repo`. Provider-aware to avoid a path
   * collision (`github:acme/api` vs `azure-devops:acme/api` sharing the same
   * `owner/name` pair are two different repos — SPEC-2026-08-25-azure-devops-integration
   * P2): a set `repo.project` (Azure DevOps only) routes through a
   * provider-segmented path; when `provider`/`project` are absent (every
   * existing GitHub `RepoRef`), the path is byte-identical to before this
   * field existed.
   */
  clonePathFor(repo: RepoRef & { provider?: VcsProvider }): string;
}

// ---------- CodeIndex (ripgrep + tree-sitter) ----------
export interface CodeMatch {
  path: string;
  line: number;
  text: string;
}

export interface CodeSymbol {
  path: string;
  name: string;
  kind: string;
  line: number;
}

export interface CodeReference {
  fromPath: string;
  toSymbol: string;
  line: number;
}

export interface CodeIndex {
  grep(repo: RepoRef, pattern: string): Promise<CodeMatch[]>;
  symbols(repo: RepoRef): Promise<CodeSymbol[]>;
  references(repo: RepoRef, symbol: string): Promise<CodeReference[]>;
}

// ---------- Auth (pluggable; MVP = LocalNoAuthProvider) ----------
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
}

export interface AuthProvider {
  currentUser(req: unknown): Promise<AuthUser>;
  currentWorkspace(req: unknown): Promise<AuthWorkspace>;
}

// ---------- Secrets (pluggable; MVP = LocalSecretsProvider) ----------
export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GITHUB_TOKEN'
  | 'AZURE_DEVOPS_TOKEN'
  | 'DATABASE_URL'
  | (string & {});

export interface SecretsProvider {
  get(key: SecretKey): Promise<string | undefined>;
  /**
   * Persist a secret (BYO key entered via the UI). Optional — read-only
   * providers (e.g. the env-only MVP backend) may omit it.
   */
  set?(key: SecretKey, value: string): Promise<void>;
}
