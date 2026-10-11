import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { skills } from './skills';
import { memory } from './knowledge';
import { ciRuns } from './ci';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
    /** FK to multi_agent_runs batch this run belongs to (null for single-agent runs). */
    multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' }),
    /**
     * Where `cost_usd` came from: 'api' = reported by the provider's billing API,
     * 'estimate' = DevDigest price table x tokens. NULL = recorded before this
     * column existed (or cost unknown) — ignored by the cost-source badge.
     */
    costSource: text('cost_source', { enum: ['api', 'estimate'] }),
    /**
     * How memory was selected for this run: 'top_k' = embedding similarity,
     * 'fallback' = deterministic selection. NULL = run predates tracking; such
     * runs are excluded from the Most-pulled-memory denominator.
     */
    memoryMode: text('memory_mode', { enum: ['top_k', 'fallback'] }),
    /** The CI run this agent run was imported from (source='ci'); null otherwise. */
    ciRunId: uuid('ci_run_id').references(() => ciRuns.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('agent_runs_ws_ran_at_idx').on(t.workspaceId, t.ranAt),
    index('agent_runs_agent_ran_at_idx').on(t.agentId, t.ranAt),
  ],
);

/** Skills that were loaded into a run's prompt, and whether the model applied them. */
export const agentRunSkills = pgTable(
  'agent_run_skills',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    skillVersion: integer('skill_version').notNull(),
    applied: boolean('applied').notNull(),
    findingsCited: integer('findings_cited').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.runId, t.skillId] })],
);

/** Memory entries that were selected into a run's prompt (rank 1 = most similar). */
export const agentRunMemory = pgTable(
  'agent_run_memory',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memory.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    /** Cosine similarity; null when the deterministic fallback selection was used. */
    similarity: doublePrecision('similarity'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.memoryId] })],
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
