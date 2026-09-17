import type { Container } from "../../platform/container.js";
import type {
  FindingActionKind,
  Intent,
  MultiAgentRun,
  MultiAgentRunSummary,
  RunEventKind,
  RunTrace,
} from "@devdigest/shared";
import { AppError, NotFoundError } from "../../platform/errors.js";
import type { AgentRow } from "../../db/rows.js";
import { ReviewRepository } from "./repository.js";
import { type ReviewDto, type ReviewDtoFinding } from "./helpers.js";
import { ReviewRunExecutor, type Logger } from "./run-executor.js";
import { actOnFinding as actOnFindingImpl } from "./findings.js";
import { reviewToDto } from "./helpers.js";
import { RunLogger } from "../../platform/run-logger.js";
import { loadDiff } from "./diff-loader.js";
import { deriveIntent } from "./intent-deriver.js";

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from "./helpers.js";
export type { ReviewDto, ReviewDtoFinding } from "./helpers.js";

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container["agentsRepo"];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError("Agent not found");
      return [agent];
    }
    throw new AppError(
      "invalid_run_request",
      "Provide agentId or all:true",
      400,
    );
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, "info", "Cancellation requested — stopping…");
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    reviews: ReviewDto[];
  }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError("Pull request not found");
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError("Repo not found");

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor
      .executeRuns(workspaceId, pull, repo, jobs, logger)
      .catch((err) => {
        logger?.error(
          { prId, err: (err as Error).message },
          "review: background execution crashed",
        );
      });

    return { runs, reviews: [] };
  }

  private publish(
    runId: string,
    kind: RunEventKind,
    msg: string,
    data?: unknown,
  ) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
    body?: { note?: string },
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action, this.container, body);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError("Pull request not found");
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(
        review,
        findings,
        review.agentId ? names.get(review.agentId) : null,
      ),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // Intent
  // ===========================================================================

  async getIntent(
    workspaceId: string,
    prId: string,
  ): Promise<Intent | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) return undefined;
    return this.repo.getIntent(prId);
  }

  async recalculateIntent(
    workspaceId: string,
    prId: string,
    logger: Logger,
  ): Promise<string | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) return undefined;
    const { diff } = await loadDiff(
      this.container,
      this.repo,
      workspaceId,
      pull,
      repo,
    );
    const runLog = new RunLogger(this.container.runBus, [], logger, { prId });
    // forceRecalculate=true bypasses the headSha cache check
    return deriveIntent(
      this.container,
      this.repo,
      workspaceId,
      pull,
      diff,
      runLog,
      undefined,
      true,
    );
  }

  // ===========================================================================
  // Multi-agent reviews
  // ===========================================================================

  /**
   * Launch a multi-agent review for a specific set of agents. Creates a
   * `multi_agent_runs` row, fires concurrent agent runs (Promise.allSettled),
   * and returns the batch ID immediately for SSE subscription.
   */
  async runMultiAgentReview(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{
    multiAgentRunId: string;
    runs: { run_id: string; agent_id: string; agent_name: string }[];
  }> {
    if (agentIds.length === 0) {
      throw new AppError("invalid_run_request", "At least one agent required", 400);
    }

    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError("Pull request not found");
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError("Repo not found");

    const targets: AgentRow[] = [];
    for (const agentId of agentIds) {
      const agent = await this.agents.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError(`Agent ${agentId} not found`);
      targets.push(agent);
    }

    // Create agent_run rows up-front so runIds are available for SSE.
    const jobs: { agent: AgentRow; runId: string }[] = [];
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Create the multi_agent_runs batch row and link all agent_runs to it.
    const batch = await this.repo.createMultiAgentRun({
      workspaceId,
      prId,
      agentRunIds: jobs.map((j) => j.runId),
    });

    // Fire-and-forget concurrent execution.
    void this.executor
      .executeRuns(workspaceId, pull, repo, jobs, logger)
      .catch((err) => {
        logger?.error(
          { prId, err: (err as Error).message },
          "multi-agent review: background execution crashed",
        );
      });

    return { multiAgentRunId: batch.id, runs };
  }

  async listMultiAgentRuns(params: {
    workspaceId: string;
    limit?: number;
    cursor?: string;
    status?: string;
    q?: string;
  }): Promise<{ items: MultiAgentRunSummary[]; next_cursor: string | null }> {
    return this.repo.listMultiAgentRuns(params);
  }

  async getMultiAgentRun(
    workspaceId: string,
    id: string,
  ): Promise<MultiAgentRun | null> {
    const run = await this.repo.getMultiAgentRunById(id);
    if (!run) return null;
    // Workspace scoping: verify the run belongs to this workspace via the PR.
    const pull = await this.repo.getPull(workspaceId, run.pr_id);
    if (!pull) return null;
    return run;
  }
}
