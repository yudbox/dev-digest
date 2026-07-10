import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import type {
  EvalCase,
  EvalCaseInput,
  EvalRunResult,
  EvalRun,
  EvalBatchSummary,
  EvalDashboard,
  EvalDashboardOverview,
  EvalOwnerKind,
  ExpectedFinding,
  Provider,
  SkillType,
} from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { sliceDiff } from '@devdigest/reviewer-core';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModelStrict } from '../settings/feature-models.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { EvalsRepository, type EvalCaseRow, type EvalRunRow } from './repository.js';
import {
  parseExpectedOutput,
  toEvalCaseDto,
  toEvalRunRecordDto,
  macroAverage,
  buildDashboard,
  buildRecentBatchSummaries,
  taskLine,
  prDescription,
} from './helpers.js';
import { scoreCase, caseTypeOf, computePass, computeCitationAccuracy } from './scoring.js';
import { SKILL_EVAL_STRATEGIES } from './skill-eval-strategies.js';
import { RECENT_RUNS_LIMIT } from './constants.js';
import type { AgentRow } from '../agents/repository.js';
import type { SkillRow } from '../skills/repository.js';

/**
 * A6 — evals service. Orchestrates: `EvalsRepository` (own tables) +
 * `container.agentsRepo` / `container.skillsRepo` (read-only owner lookups,
 * per the Onion cross-module-read rule) + `reviewPullRequest` from
 * `@devdigest/reviewer-core` (the ONLY place LLM calls happen in this module).
 * `scoring.ts` (pure, 0 LLM) does all the metric math.
 */
export class EvalsService {
  private repo: EvalsRepository;

  constructor(private container: Container) {
    this.repo = new EvalsRepository(container.db);
  }

  // ---- eval_cases CRUD ------------------------------------------------------

  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });
    return toEvalCaseDto(row);
  }

  async listCases(
    workspaceId: string,
    ownerKind?: EvalOwnerKind,
    ownerId?: string,
  ): Promise<EvalCase[]> {
    const rows = await this.repo.listCases(workspaceId, ownerKind, ownerId);
    return rows.map(toEvalCaseDto);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const row = await this.repo.getCase(workspaceId, id);
    return row ? toEvalCaseDto(row) : undefined;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: Partial<EvalCaseInput>,
  ): Promise<EvalCase | undefined> {
    const row = await this.repo.updateCase(workspaceId, id, {
      ...(patch.owner_kind !== undefined ? { ownerKind: patch.owner_kind } : {}),
      ...(patch.owner_id !== undefined ? { ownerId: patch.owner_id } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined
        ? { expectedOutput: patch.expected_output }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  // ---- running cases ---------------------------------------------------------

  /** `POST /eval-cases/:id/run` — single case, either owner kind. */
  async runCase(workspaceId: string, caseId: string): Promise<EvalRunResult> {
    const evalCase = await this.repo.getCase(workspaceId, caseId);
    if (!evalCase) throw new NotFoundError('Eval case not found');

    const batchId = randomUUID();
    const ranAt = new Date();

    if (evalCase.ownerKind === 'agent') {
      const agent = await this.container.agentsRepo.getById(workspaceId, evalCase.ownerId);
      if (!agent) throw new NotFoundError('Agent not found for this eval case');
      const { runRow, result } = await this.runOneAgentCase(agent, evalCase, batchId, ranAt);
      return { run_id: runRow.id, case_id: evalCase.id, result };
    }

    const skill = await this.container.skillsRepo.getById(workspaceId, evalCase.ownerId);
    if (!skill) throw new NotFoundError('Skill not found for this eval case');
    const { provider, model } = await resolveFeatureModelStrict(this.container, workspaceId, 'eval');
    const { runRow, result } = await this.runOneSkillCase(
      provider,
      model,
      skill,
      evalCase,
      batchId,
      ranAt,
    );
    return { run_id: runRow.id, case_id: evalCase.id, result };
  }

  /**
   * `POST /agents/:id/eval-runs` — "Run all evals" for one agent (AC-6/AC-7).
   * `preloadedAgent` lets `runAllForWorkspace` pass an already-fetched agent
   * row (from its own single batched `listEnabled()` call) instead of this
   * method re-fetching it by id per agent in that loop — no N+1 repo read.
   */
  async runAgentEvals(
    workspaceId: string,
    agentId: string,
    preloadedAgent?: AgentRow,
  ): Promise<{ summary: EvalBatchSummary; runs: EvalRunResult[] }> {
    const agent = preloadedAgent ?? (await this.container.agentsRepo.getById(workspaceId, agentId));
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.repo.listCases(workspaceId, 'agent', agentId);
    const batchId = randomUUID();
    const ranAt = new Date();

    const runs: EvalRunResult[] = [];
    const runRows: EvalRunRow[] = [];
    for (const c of cases) {
      const { runRow, result } = await this.runOneAgentCase(agent, c, batchId, ranAt);
      runRows.push(runRow);
      runs.push({ run_id: runRow.id, case_id: c.id, result });
    }

    const avg = macroAverage(runRows);
    const summary: EvalBatchSummary = {
      batch_id: batchId,
      agent_id: agentId,
      agent_version: agent.version,
      ran_at: ranAt.toISOString(),
      cases_total: cases.length,
      recall: avg.recall,
      precision: avg.precision,
      citation_accuracy: avg.citation_accuracy,
      traces_passed: avg.traces_passed,
      cost_usd: avg.cost_usd,
    };
    return { summary, runs };
  }

  /** `POST /skills/:id/eval-runs` — runs every case owned by the skill
   *  (2 LLM calls each — AC-24). Resolves the "eval" feature model ONCE,
   *  up front, so a missing model config fails clean (AC-26) before any
   *  case runs at all. No `EvalBatchSummary` here — `EvalBatchSummary.agent_id`
   *  is non-nullable and skill batches have no agent (Q7). */
  async runSkillEvals(workspaceId: string, skillId: string): Promise<{ runs: EvalRunResult[] }> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    const { provider, model } = await resolveFeatureModelStrict(this.container, workspaceId, 'eval');

    const cases = await this.repo.listCases(workspaceId, 'skill', skillId);
    const batchId = randomUUID();
    const ranAt = new Date();

    const runs: EvalRunResult[] = [];
    for (const c of cases) {
      const { runRow, result } = await this.runOneSkillCase(
        provider,
        model,
        skill,
        c,
        batchId,
        ranAt,
      );
      runs.push({ run_id: runRow.id, case_id: c.id, result });
    }
    return { runs };
  }

  /** `POST /eval-runs/all` — only enabled agents with ≥1 eval case (AC-16). */
  async runAllForWorkspace(workspaceId: string): Promise<EvalBatchSummary[]> {
    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    const caseCounts = await this.repo.casesCountByOwner(workspaceId, 'agent');
    const eligible = agents.filter((a) => (caseCounts.get(a.id) ?? 0) > 0);

    const summaries: EvalBatchSummary[] = [];
    for (const agent of eligible) {
      const { summary } = await this.runAgentEvals(workspaceId, agent.id, agent);
      summaries.push(summary);
    }
    return summaries;
  }

  // ---- per-case run helpers ---------------------------------------------------

  /** One agent-owned case: exactly 1 `reviewPullRequest` call (AC-5). */
  private async runOneAgentCase(
    agent: AgentRow,
    evalCase: EvalCaseRow,
    batchId: string,
    ranAt: Date,
  ): Promise<{ runRow: EvalRunRow; result: EvalRun }> {
    const expected = parseExpectedOutput(evalCase.expectedOutput) as ExpectedFinding[];
    const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');
    const llm = await this.container.llm(agent.provider as Provider);
    const prDesc = prDescription(evalCase);

    const start = Date.now();
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      ...(prDesc ? { prDescription: prDesc } : {}),
      task: taskLine(evalCase),
    });
    const durationMs = Date.now() - start;

    const score = scoreCase(expected, outcome.review.findings);
    const caseType = caseTypeOf(expected);
    const pass = computePass(caseType, score);
    const citationAccuracy = computeCitationAccuracy(
      outcome.review.findings.length,
      outcome.dropped.length,
    );

    const runRow = await this.repo.insertRun({
      caseId: evalCase.id,
      ranAt,
      actualOutput: outcome.review.findings,
      pass,
      recall: score.recall,
      precision: score.precision,
      citationAccuracy,
      durationMs,
      costUsd: outcome.costUsd,
      batchId,
      agentVersion: agent.version,
    });

    const result: EvalRun = {
      recall: score.recall,
      precision: score.precision,
      citation_accuracy: citationAccuracy,
      traces_passed: pass ? 1 : 0,
      traces_total: 1,
      duration_ms: durationMs,
      cost_usd: outcome.costUsd,
      per_trace: [{ name: evalCase.name, pass, expected, actual: outcome.review.findings }],
    };
    return { runRow, result };
  }

  /**
   * Skills from untrusted external sources (URL / community) are
   * delimiter-wrapped so their body cannot act as injected instructions —
   * the EXACT same guard `run-executor.ts` applies before injecting a skill
   * body into a normal review prompt. Required here too: `runOneSkillCase`
   * concatenates the body directly into `systemPrompt` (AC-24/Q6's specified
   * shape), which is otherwise exactly the "never concatenate untrusted
   * content directly into the system prompt" case reviewer-core's own rules
   * warn about.
   */
  private static readonly UNTRUSTED_SKILL_SOURCES = new Set(['imported_url', 'community']);
  private wrapSkillBodyIfUntrusted(skill: SkillRow): string {
    if (!EvalsService.UNTRUSTED_SKILL_SOURCES.has(skill.source)) return skill.body;
    return `<untrusted source="skill:${skill.source}">\n${skill.body.replaceAll('</untrusted>', '<\\/untrusted>')}\n</untrusted>`;
  }

  /**
   * One skill-owned case: dispatches to the registered `SkillEvalStrategy`
   * for the skill's `type` (`SKILL_EVAL_STRATEGIES`) — `convention`/
   * `security`/`custom` run the finding-grounded with/without comparison
   * (exactly 2 `reviewPullRequest` calls, AC-24/AC-27/Q6); `rubric` runs a
   * single direct `completeStructured` call (AC-11). The untrusted-source
   * wrapping guard (`wrapSkillBodyIfUntrusted`) is computed ONCE here and
   * passed into the strategy as `wrappedBody` — every strategy receives an
   * already-safe body, never the raw skill body, so this refactor cannot
   * accidentally drop the security wrapping for either path.
   */
  private async runOneSkillCase(
    provider: Provider,
    model: string,
    skill: SkillRow,
    evalCase: EvalCaseRow,
    batchId: string,
    ranAt: Date,
  ): Promise<{ runRow: EvalRunRow; result: EvalRun }> {
    const wrappedBody = this.wrapSkillBodyIfUntrusted(skill);
    const strategy = SKILL_EVAL_STRATEGIES[skill.type as SkillType];
    const outcome = await strategy.execute({
      container: this.container,
      provider,
      model,
      skill,
      evalCase,
      wrappedBody,
    });

    const runRow = await this.repo.insertRun({
      caseId: evalCase.id,
      ranAt,
      actualOutput: outcome.actualOutput,
      pass: outcome.pass,
      recall: outcome.recall,
      precision: outcome.precision,
      citationAccuracy: outcome.citationAccuracy,
      durationMs: outcome.durationMs,
      costUsd: outcome.costUsd,
      batchId,
      agentVersion: null,
    });

    const expected = parseExpectedOutput(evalCase.expectedOutput, skill.type as SkillType);
    const result: EvalRun = {
      recall: outcome.recall,
      precision: outcome.precision,
      // `EvalRun.citation_accuracy` (the immediate per-run result contract) is
      // non-nullable — unlike the persisted `EvalRunRecord.citation_accuracy`.
      // Rubric cases have no citation-accuracy concept at all (no grounding
      // pass); the client omits the Citation Accuracy tile entirely for
      // rubric skills (never renders this value), so `0` here is an inert
      // placeholder — the true `null` is what gets persisted to `eval_runs`.
      citation_accuracy: outcome.citationAccuracy ?? 0,
      traces_passed: outcome.pass ? 1 : 0,
      traces_total: 1,
      duration_ms: outcome.durationMs,
      cost_usd: outcome.costUsd,
      per_trace: [{ name: evalCase.name, pass: outcome.pass, expected, actual: outcome.actualOutput }],
    };
    return { runRow, result };
  }

  // ---- dashboards -------------------------------------------------------------

  /** `GET /agents/:id/eval-dashboard` / `GET /skills/:id/eval-dashboard`. */
  async dashboardForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalDashboard> {
    let skillType: SkillType | undefined;
    if (ownerKind === 'agent') {
      const agent = await this.container.agentsRepo.getById(workspaceId, ownerId);
      if (!agent) throw new NotFoundError('Agent not found');
    } else {
      const skill = await this.container.skillsRepo.getById(workspaceId, ownerId);
      if (!skill) throw new NotFoundError('Skill not found');
      skillType = skill.type as SkillType;
    }

    const cases = await this.repo.listCases(workspaceId, ownerKind, ownerId);
    const runs = await this.repo.runsForOwnerKind(workspaceId, ownerKind, ownerId);
    const recentRuns = runs
      .slice(0, RECENT_RUNS_LIMIT)
      .map((r) => toEvalRunRecordDto(r.run, r.caseName));

    return buildDashboard(ownerKind, ownerId, cases.length, runs, recentRuns, skillType);
  }

  /** `GET /eval-dashboard` — workspace landing overview (AC-13/14/15). */
  async dashboardOverview(workspaceId: string): Promise<EvalDashboardOverview> {
    const agents = await this.container.agentsRepo.list(workspaceId);
    const allRuns = await this.repo.runsForOwnerKind(workspaceId, 'agent');
    const caseCounts = await this.repo.casesCountByOwner(workspaceId, 'agent');

    const runsByAgent = new Map<string, typeof allRuns>();
    for (const r of allRuns) {
      const arr = runsByAgent.get(r.ownerId) ?? [];
      arr.push(r);
      runsByAgent.set(r.ownerId, arr);
    }

    const agentDashboards = agents.map((agent) => {
      const runs = runsByAgent.get(agent.id) ?? [];
      const recentRuns = runs
        .slice(0, RECENT_RUNS_LIMIT)
        .map((r) => toEvalRunRecordDto(r.run, r.caseName));
      return buildDashboard('agent', agent.id, caseCounts.get(agent.id) ?? 0, runs, recentRuns);
    });

    const recentRuns = buildRecentBatchSummaries(allRuns, RECENT_RUNS_LIMIT);
    return { agents: agentDashboards, recent_runs: recentRuns };
  }

  // ---- findings prefill ---------------------------------------------------------

  /**
   * `POST /findings/:id/eval-case` — build (never insert) an `EvalCaseInput`
   * prefilled from a resolved finding (AC-9). Accepted → one expected finding;
   * dismissed (or otherwise unresolved) → empty `expected_output`.
   */
  async prefillFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseInput> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    const expectedOutput =
      finding.acceptedAt != null
        ? [
            {
              file: finding.file,
              start_line: finding.startLine,
              end_line: finding.endLine,
              severity: finding.severity,
              category: finding.category,
              title: finding.title,
            },
          ]
        : [];

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found for this finding');

    const diff = await loadDiff(this.container, this.container.reviewRepo, workspaceId, pull, repoRow);
    // sliceDiff's own fallback returns the WHOLE raw diff when the file isn't
    // found — that does not match the "file missing → empty input_diff" edge
    // case, so check presence explicitly first.
    const fileInDiff = diff.files.some((f) => f.path === finding.file);
    const inputDiff = fileInDiff ? sliceDiff(diff, finding.file) : '';

    return {
      owner_kind: 'agent',
      owner_id: review.agentId ?? '',
      name: `From finding: ${finding.title}`,
      input_diff: inputDiff,
      input_files: null,
      input_meta: {
        pr_title: `PR #${pull.number}: ${pull.title}`,
        ...(pull.body ? { pr_body: pull.body } : {}),
      },
      expected_output: expectedOutput,
      notes: `Prefilled from finding ${finding.id} (${finding.acceptedAt != null ? 'accepted' : 'dismissed'}).`,
    };
  }
}
