/**
 * AggregateService — orchestrates the "Aggregate tab" LLM deduplication pass.
 *
 * Pipeline:
 *   1. Load multi-agent run (workspace-scoped via getPull)
 *   2. Collect source findings from done columns only
 *   3. Enforce AGGREGATE_MAX_FINDINGS hard limit (422 if exceeded)
 *   4. Resolve LLM via resolveFeatureModelStrict
 *   5. Pre-group findings by file + line proximity
 *   6. Build prompt (system + user)
 *   7. completeStructured with soft schema (groups: z.array(z.unknown()))
 *   8. Per-element safeParse with LlmAggregateGroupSchema (drop invalid rows, log warnings)
 *   9. groundGroups — filter unknown/duplicate/cross-file ids
 *  10. Return AggregateResponse (no DB writes)
 */
import type { Container } from '../../platform/container.js';
import type { AggregateResponse, Provider } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ReviewRepository } from './repository.js';
import { resolveFeatureModelStrict } from '../settings/feature-models.js';
import {
  AGGREGATE_FEATURE_MODEL_ID,
  AGGREGATE_MAX_FINDINGS,
} from './constants.js';
import {
  collectSourceFindings,
  preGroupFindings,
  groundGroups,
} from './aggregate-helpers.js';
import {
  AGGREGATE_SYSTEM_PROMPT,
  LlmAggregateGroupSchema,
  LlmAggregateResponseSchema,
  buildAggregateUserPrompt,
} from './aggregate-prompt.js';

export class AggregateService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  /**
   * Run the deduplication pass for a completed multi-agent review run.
   * Returns a transient AggregateResponse — nothing is written to the DB.
   */
  async aggregate(
    workspaceId: string,
    runId: string,
  ): Promise<AggregateResponse> {
    // 1. Load run + workspace scoping.
    const run = await this.repo.getMultiAgentRunById(runId);
    if (!run) throw new NotFoundError('Multi-agent run not found');

    const pull = await this.repo.getPull(workspaceId, run.pr_id);
    if (!pull) throw new NotFoundError('Multi-agent run not found');

    // 2. Collect source findings (done columns only).
    const sources = collectSourceFindings(run);

    // 3. Hard limit check.
    if (sources.length > AGGREGATE_MAX_FINDINGS) {
      throw new ValidationError(
        `Too many source findings (${sources.length} > ${AGGREGATE_MAX_FINDINGS}). ` +
          'Reduce the number of agents or findings per agent.',
      );
    }

    if (sources.length === 0) {
      // Nothing to aggregate — return an empty result immediately.
      return {
        multi_agent_run_id: runId,
        generated_at: new Date().toISOString(),
        model: 'none',
        source_findings_total: 0,
        groups: [],
      };
    }

    // 4. Resolve LLM.
    const { provider, model } = await resolveFeatureModelStrict(
      this.container,
      workspaceId,
      AGGREGATE_FEATURE_MODEL_ID,
    );

    let llm;
    try {
      llm = await this.container.llm(provider as Provider);
    } catch (err) {
      throw new ValidationError(
        `Aggregate: LLM provider "${provider}" not configured — ${(err as Error).message}`,
      );
    }

    // 5. Build lookup maps from run columns.
    //    findingDetails: finding_id → { end_line, category }
    //    texts: finding_id → { finding_id, file, start_line, title, rationale, suggestion }
    const findingDetails = new Map<string, { end_line: number; category: string }>();
    const texts = new Map<
      string,
      {
        finding_id: string;
        file: string;
        start_line: number;
        title: string;
        rationale: string;
        suggestion: string;
      }
    >();

    for (const col of run.columns) {
      if (col.status !== 'done') continue;
      for (const f of col.findings) {
        findingDetails.set(f.id, { end_line: f.end_line, category: f.category });
        texts.set(f.id, {
          finding_id: f.id,
          file: f.file,
          start_line: f.start_line,
          title: f.title,
          rationale: f.rationale,
          suggestion: f.suggestion ?? '',
        });
      }
    }

    // 6. Pre-group findings by file + line proximity.
    const candidateGroups = preGroupFindings(sources);

    // 7. Build user prompt.
    const userPrompt = buildAggregateUserPrompt(candidateGroups, texts);

    // 8. Call LLM with soft schema (groups: z.array(z.unknown())).
    const result = await llm.completeStructured({
      model,
      schema: LlmAggregateResponseSchema,
      schemaName: 'LlmAggregateResponse',
      messages: [
        { role: 'system', content: AGGREGATE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    // 9. Per-element safeParse — drop malformed rows, log warnings.
    const llmGroups: Array<{ finding_ids: string[]; title: string; reviewer_comment: string }> = [];
    for (const raw of result.data.groups) {
      const parsed = LlmAggregateGroupSchema.safeParse(raw);
      if (parsed.success) {
        llmGroups.push(parsed.data);
      }
      // Non-fatal: malformed elements are silently dropped (soft-schema guard).
    }

    // 10. Ground groups against known sources.
    const groups = groundGroups(llmGroups, sources, findingDetails);

    return {
      multi_agent_run_id: runId,
      generated_at: new Date().toISOString(),
      model: `${provider}/${model}`,
      source_findings_total: sources.length,
      groups,
    };
  }
}
