# Plan: Eval Pipeline

> Status: DRAFT
> Created: 2026-07-07
> Spec: specs/SPEC-2026-07-06-eval-pipeline.md
> Execution Mode: multi-agent (backend implementer ∥ frontend implementer)

## Requirements (VRF)
> Status: Confirmed (defaults for Q1/Q2/Q4 accepted; Q3 corrected per coordinator; execution mode = multi-agent)

| ID | Requirement | Source |
|----|------------|--------|
| R1 | Migration adds `batch_id` (uuid, nullable) + `agent_version` (integer, nullable) to `eval_runs` + index on `batch_id`; `eval_cases` untouched; no existing migration file edited | AC-1 |
| R2 | `POST /eval-cases` inserts row from `EvalCaseInput`, resolves owner_kind/owner_id, returns `EvalCase`; provenance text goes in existing `notes` field only | AC-2 |
| R3 | Scoring computes recall/precision/tp/fp/fn with 0 LLM calls; match = same `file` AND overlapping `[start_line,end_line]` | AC-3 |
| R4 | `recall=1.0` when `expected.length===0`; `precision=1.0` when `actual.length===0` | AC-4 |
| R5 | `POST /eval-cases/:id/run` (agent case) runs `reviewPullRequest` with agent's systemPrompt/model/provider (exactly 1 LLM call), scores, inserts `eval_runs` row with new `batch_id` + `agent_version=agent.version` | AC-5 |
| R6 | `POST /agents/:id/eval-runs` runs all agent's cases under one shared `batch_id`, aggregates via macro-average, returns `EvalBatchSummary` + `EvalRunResult[]` | AC-6 |
| R7 | Agent with ≥8 mixed cases: editing system prompt between two "Run all evals" batches produces measurably different aggregated recall/precision | AC-7 |
| R8 | `FindingCard` "Turn into eval case" button enabled only when finding resolved | AC-8 |
| R9 | Click calls `POST /findings/:id/eval-case` — returns prefilled `EvalCaseInput` (no DB insert); opens `EvalCaseModal`; save goes through normal `POST /eval-cases` | AC-9 |
| R10 | `EvalCaseModal` shows computed POSITIVE/NEGATIVE banner based on `expected_output.length` | AC-10 |
| R11 | `pass` formulas per case type (must_find / must_not_flag) | AC-11 |
| R12 | `citation_accuracy` reuses `groundFindings` result from `reviewPullRequest`, no 2nd grounding pass | AC-12 |
| R13 | `/eval` shows every agent (incl. no cases/no runs) with placeholder states; row click → `/eval/[agentId]` | AC-13 |
| R14 | `GET /eval-dashboard` → `{ agents: EvalDashboard[], recent_runs: EvalBatchSummary[] }` | AC-14 |
| R15 | No batch runs workspace-wide → `recent_runs=[]` → client `EmptyState` | AC-15 |
| R16 | `POST /eval-runs/all` runs only `enabled=true` agents with `eval_cases.count>0` | AC-16 |
| R17 | `/eval/[agentId]` shows 3 `MetricCard`s w/ deltas, `LineChart`, runs table | AC-17 |
| R18 | <2 batches → no delta arrows; "TRACES PASSED" never has a delta | AC-18 |
| R19 | Notable pass-flip between last 2 batches → `EvalDashboard.alert` names the case; else `null` | AC-19 |
| R20 | `CompareRunsModal` shows metric deltas + GitHub-style LCS diff of `system_prompt` via existing `parsePatch`+`CodeLine` | AC-20 |
| R21 | "Promote" applies only `system_prompt` via existing agent-update endpoint; disabled if selected version === current | AC-21 |
| R22 | `pnpm verify:l06`-equivalent script runs server typecheck → client typecheck → hermetic scoring test → integration test; exit 0 iff all green | AC-22 |
| R23 | `EvalsTab` = one component (`ownerKind`/`ownerId` props), mounted in `AgentEditor` and `SkillEditor` | AC-23 |
| R24 | Skill case run = 2 `reviewPullRequest` calls via reference-agent (with-skill / without-skill), both scored and stored | AC-24 |
| R25 | Reference-agent model via `resolveFeatureModelStrict(container, workspaceId, "eval")`; reference prompt = constant | AC-25 |
| R26 | No `"eval"` model chosen → `ValidationError` → clear 4xx, not 500 | AC-26 |
| R27 | Skill pass formula (v1 boolean with/without gate) | AC-27 |
| R28 | `SkillEditor` Evals tab: case list + with/without tiles only; no trend/history/Compare/Promote/dashboard-link (agent tab keeps the link) | AC-28 |
| R29 | `GET /skills/:id/eval-dashboard` → full `EvalDashboard` reused as-is; skill client renders only `current`/`delta`/`alert` | AC-29 |
| R30 (bonus) | `AgentCard` stats row via new batched `AgentsRepository.statsForWorkspace()` | AC-30 |
| R31 (bonus) | `SkillCard` stats via rewritten `SkillsRepository.listWithStats()` + `agentCountsForWorkspace()` | AC-31 |

## Open Questions & Recommendations

| # | Question | Answer | Type |
|---|----------|--------|------|
| Q1 | `EvalDashboard.recent_runs` (`EvalRunRecord[]`) vs landing endpoint's `recent_runs` (`EvalBatchSummary[]`) — same name, different shape | Do not touch `EvalDashboard`. Add a **new wrapper contract** `EvalDashboardOverview = { agents: EvalDashboard[], recent_runs: EvalBatchSummary[] }` for `GET /eval-dashboard` only. `EvalDashboard.recent_runs: EvalRunRecord[]` stays as the per-owner raw run history used by agent/skill detail views. | gap / 💡 |
| Q2 | Implement AC-27 skill-pass formula literally (v1 boolean) or push back for a numeric threshold? | Implement literally as specified. Directly unit-testable, matches the AC-27 verification hint, and the spec's own edge cases treat "model catches finding without skill → pass=false" as intentional. Threshold-tuning stays explicitly out of scope (see Risks). | gap / 💡 |
| Q3 | Where does the cross-cutting `verify:l06` check live, given `evals/` at repo root is a **different, pre-existing** package (the L06 meta-eval harness for this repo's own `.claude/skills`/`.claude/agents`, imported on this branch via `0d39cf1`/`5921c20`, with its own `pnpm eval:*` scripts)? | **Corrected per coordinator.** Do NOT touch `evals/package.json`. New home: `scripts/verify-l06.sh` (shell script, following the exact convention of `scripts/dev.sh` / `scripts/e2e.sh`) that internally runs `cd server && pnpm typecheck`, `cd server && pnpm exec vitest run <scoring test + integration test>`, `cd client && pnpm typecheck`, propagating exit codes. Hermetic scoring test + integration test are normal `*.test.ts`/`*.it.test.ts` files inside `server/`, not inside `evals/`. | 🚩 red flag / corrected |
| Q4 | Concrete `N` for `recent_runs` in `GET /eval-dashboard`; default model for new `"eval"` Feature Model | `N = 20` (spec's own suggestion). `defaultProvider: "openrouter"`, `defaultModel: "deepseek/deepseek-v4-flash"` — matches the existing cheap/fast tier already used for `onboarding` and `review_intent` (high-frequency, lower-stakes features), consistent with eval runs being frequent and cost-sensitive. | gap / 💡 |
| Q5 (discovered during research, not in original VRF) | `rangeIntersects` in `reviewer-core/src/grounding.ts` has signature `(lines: Set<number>, start, end)` (range-vs-line-index) and is **not exported** from `reviewer-core/src/index.ts` — it does not match AC-3's "range intersects range" description and can't be imported as-is. | Add a **new**, separately-named, exported two-range primitive `rangesOverlap(aStart, aEnd, bStart, bEnd): boolean` to `grounding.ts`, exported from `index.ts`. Zero behavior change to `groundFindings` (which keeps using its private `rangeIntersects`); `scoring.ts` imports `rangesOverlap`. | 💡 recommendation |
| Q6 (discovered during research) | `eval_runs` has ONE set of recall/precision/citation_accuracy/pass columns, but AC-24 wants both with-skill and without-skill metric pairs stored per skill-case run, and no new table/columns are in scope. | One `eval_runs` row per skill-case run. Top-level `recall`/`precision`/`citation_accuracy` mirror the **with-skill** result (the headline number); the full `{with: {...}, without: {...}}` detail goes in the existing `actual_output` jsonb column (already unstructured-by-design for exactly this). `duration_ms`/`cost_usd` = sum of both calls. `agent_version` stays `null` for skill-owned rows (only agents have versions). | 💡 recommendation |
| Q7 (discovered during research) | AC-28's "поточне with/without" tiles vs AC-29's "EvalDashboard reused as-is, not truncated" — `EvalDashboard.current` is a single flat metrics object, no with/without split. | `EvalDashboard.current` for a skill = the **with-skill** aggregate only (same 3 tiles as the agent dashboard — Recall/Precision/Citation). The with/without comparison is realized in (a) the AC-27 pass formula baked into every case, and (b) the per-case `actual_output.with`/`.without` detail visible when a user opens an individual case's last run (via the case-list/case-detail endpoints, not via `EvalDashboard`). No dashboard contract change needed. | 💡 recommendation |
| Q8 (discovered during research) | Spec's Contracts section says Promote uses "**existing** `PATCH /agents/:id`" — no such route exists; `agents/routes.ts` only has `PUT /agents/:id` (already fully partial-update via all-optional `UpdateAgentBody` fields). | Promote calls the existing `PUT /agents/:id` with body `{ system_prompt: <selected version's prompt> }`. Purely a naming correction from the spec ("PATCH" meant semantically, not literally) — no new route needed. | 💡 recommendation |
| Q9 (discovered during research) | AC-20's diff needs the OLD `system_prompt` text for a given `agent_version` — no endpoint currently exposes `agent_versions` rows (unlike skills, which have `GET /skills/:id/versions`). | Add `GET /agents/:id/versions` → `AgentVersionSummary[] = { version, system_prompt, created_at }[]`, mirroring the skills pattern exactly (`AgentsRepository.listVersions()`, new `AgentVersionSummary` contract in `knowledge.ts`). `CompareRunsModal` fetches once per agent and looks up the two selected runs' versions client-side. | 💡 recommendation |

## Affected Modules

| Module | Path | Change Type |
|--------|------|-------------|
| backend: `evals` (new) | `server/src/modules/evals/` | Add |
| backend: `reviews` | `server/src/modules/reviews/routes.ts` | Modify (add `POST /findings/:id/eval-case`) |
| backend: `agents` | `server/src/modules/agents/{routes,service,repository}.ts` | Modify (versions endpoint AC-20/Q9; bonus stats AC-30) |
| backend: `skills` | `server/src/modules/skills/{service,repository}.ts` | Modify (bonus stats AC-31) |
| backend: `platform` | `server/src/platform/container.ts`, `server/src/modules/index.ts` | Modify |
| backend: shared contracts | `server/src/vendor/shared/contracts/{eval-ci,platform,knowledge}.ts` | Modify (additive) |
| backend: `reviewer-core` | `reviewer-core/src/grounding.ts`, `reviewer-core/src/index.ts` | Modify (additive export) |
| backend: db schema | `server/src/db/schema/eval.ts`, `server/src/db/migrations/0018_*.sql` | Modify / Add (generated) |
| frontend: shared contracts mirror | `client/src/vendor/shared/contracts/{eval-ci,platform,knowledge}.ts` | Modify (additive, manual mirror) |
| frontend: hooks/api | `client/src/lib/api.ts`, `client/src/lib/hooks/evals.ts` | Modify / Add |
| frontend: `EvalsTab`/`EvalCaseModal` (new, shared) | `client/src/components/evals/` | Add |
| frontend: `AgentEditor` | `client/src/app/agents/[id]/_components/AgentEditor/`, `client/src/app/agents/[id]/page.tsx` | Modify |
| frontend: `SkillEditor` | `client/src/app/skills/[id]/_components/SkillEditor/` | Modify |
| frontend: `FindingCard`/`FindingsPanel` | `client/src/app/repos/[repoId]/pulls/[number]/_components/{FindingCard,FindingsPanel}/` | Modify |
| frontend: Eval Dashboard pages (new) | `client/src/app/eval/` | Add |
| frontend: diff LCS util (new) | `client/src/lib/diff/lcs-diff.ts` | Add |
| frontend: `AgentCard`/`SkillCard` (bonus) | `client/src/app/agents/_components/AgentCard/`, `client/src/app/skills/_components/SkillCard/` | Modify |
| root scripts | `scripts/verify-l06.sh` | Add |

---

## Tasks

### TASK-001: Shared contracts + eval schema migration + reviewer-core primitive

**Scope:** backend

**Owned Paths:**
- `server/src/db/schema/eval.ts`
- `server/src/db/migrations/` (generated `0018_*.sql` — never hand-write; `pnpm db:generate` then `pnpm db:migrate`)
- `server/src/vendor/shared/contracts/eval-ci.ts`
- `server/src/vendor/shared/contracts/platform.ts`
- `client/src/vendor/shared/contracts/eval-ci.ts` (manual mirror)
- `client/src/vendor/shared/contracts/platform.ts` (manual mirror)
- `reviewer-core/src/grounding.ts`
- `reviewer-core/src/index.ts`

**Details:**
- `eval.ts`: add `batchId: uuid('batch_id')` (nullable) and `agentVersion: integer('agent_version')` (nullable) to `evalRuns`; add an index on `batchId` (e.g. `index('eval_runs_batch_id_idx').on(t.batchId)`). Do not touch `evalCases`.
- `eval-ci.ts`: extend `EvalRunRecord` with `batch_id: z.string().nullable()` and `agent_version: z.number().int().nullable()`. Add new `EvalBatchSummary` (`batch_id, agent_id, agent_version, ran_at, cases_total, recall, precision, citation_accuracy, traces_passed, cost_usd`). Add new `EvalDashboardOverview = { agents: z.array(EvalDashboard), recent_runs: z.array(EvalBatchSummary) }` (resolves Q1 — do not modify `EvalDashboard` itself). Add new `ExpectedFinding = { file, start_line, end_line, severity: Severity.optional(), category: FindingCategory.optional(), title: z.string().optional() }` for safely parsing `eval_cases.expected_output` (currently `z.unknown()`).
- `platform.ts`: add `"eval"` as the 6th `FeatureModelId` enum value; add its `FEATURE_MODELS` entry with `defaultProvider: "openrouter"`, `defaultModel: "deepseek/deepseek-v4-flash"` (Q4).
- Mirror both files' additive changes into `client/src/vendor/shared/contracts/` (manual copy — this vendor copy is NOT a symlink; per `client/insights/INSIGHTS.md`, changes must be applied independently).
- `reviewer-core/src/grounding.ts`: add `export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean` — a genuine two-range overlap primitive (Q5). Do **not** modify the existing private `rangeIntersects` or `groundFindings` behavior. Export `rangesOverlap` from `reviewer-core/src/index.ts` alongside the existing `groundFindings`/`groundingSummary` exports.

**Acceptance Criteria:**
- [ ] AC-001: `\d eval_runs` after `pnpm db:migrate` shows `batch_id uuid`, `agent_version integer`, both nullable, plus an index on `batch_id` — maps to R1
- [ ] AC-002: `EvalRunRecord`, `EvalBatchSummary`, `EvalDashboardOverview`, `ExpectedFinding` all `z.infer` cleanly and are exported from the barrel — maps to R14
- [ ] AC-003: `FEATURE_MODELS` has exactly 6 entries including `"eval"` with the specified defaults
- [ ] AC-004: `rangesOverlap(1,5,4,8)` → `true`; `rangesOverlap(1,3,10,12)` → `false`; existing `groundFindings` unit tests (if any) still pass unmodified

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-001 | `cd server && pnpm db:generate && pnpm db:migrate` → `psql` `\d eval_runs` |
| AC-002 | `cd server && pnpm typecheck` clean; `cd client && pnpm typecheck` clean |
| AC-003 | Manual read of `FEATURE_MODELS` array length + new entry fields |
| AC-004 | `cd reviewer-core && npm test` — add a small inline check or rely on TASK-002's scoring tests exercising it |

---

### TASK-002: Scoring engine (pure, 0 LLM)

**Scope:** backend

**Owned Paths:**
- `server/src/modules/evals/scoring.ts`

**Details:**
- `scoreCase(expected: ExpectedFinding[], actual: Finding[]): { recall: number; precision: number; tp: number; fp: number; fn: number }` — match = same `file` AND `rangesOverlap(expected.start_line, expected.end_line, actual.start_line, actual.end_line)` (imported from `@devdigest/reviewer-core`). `recall = 1.0` iff `expected.length === 0` (AC-4); `precision = 1.0` iff `actual.length === 0` (AC-4).
- `computePass(caseType: 'must_find' | 'must_not_flag', score): boolean` — `must_find`: `recall===1 && precision===1`; `must_not_flag`: `precision===1` (AC-11). `caseType` is derived, not stored: `expected_output.length > 0 ? 'must_find' : 'must_not_flag'` — same derivation as the client's POSITIVE/NEGATIVE banner (AC-10), keep this derivation in one exported helper (e.g. `caseTypeOf(expected: ExpectedFinding[])`) so server and any shared logic agree.
- `computeCitationAccuracy(keptCount: number, droppedCount: number): number` — `keptCount / (keptCount + droppedCount)`, `1.0` when both are `0` (AC-12).
- `computeSkillPass(caseType, withScore, withoutScore): boolean` — `must_find`: `withScore` passes `must_find` criterion AND `withoutScore` does NOT (AC-27, Q2 — implemented literally, no threshold); `must_not_flag`: `withScore.precision === 1` (with-skill produces no false-flag in region).
- Zero imports from Fastify/Drizzle/DB — pure functions only, per Onion domain/application-layer rules. This file has NO LLM calls anywhere (AC-3's hard requirement) — a hermetic test asserting a mock LLM-call-counter stays at 0 is the enforcement mechanism (Phase 4).

**Acceptance Criteria:**
- [ ] AC-005: `scoreCase` on fixed expected/actual fixtures produces exact recall/precision/tp/fp/fn — maps to R3, R4
- [ ] AC-006: `computePass` matches AC-11's truth table exactly for both case types
- [ ] AC-007: `computeSkillPass` matches AC-27's truth table (with passes + without fails → true; both pass → false)
- [ ] AC-008: `computeCitationAccuracy(3,1)` → `0.75`; `computeCitationAccuracy(0,0)` → `1.0`

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-005..008 | `cd server && pnpm exec vitest run src/modules/evals/scoring.test.ts` (hermetic, written in Phase 4) — assert a `MockLLMProvider` call counter is never incremented anywhere in this file's call graph |

---

### TASK-003: Evals module — repository, service, routes, container wiring, findings-prefill

**Scope:** backend

**Owned Paths:**
- `server/src/modules/evals/repository.ts`
- `server/src/modules/evals/service.ts`
- `server/src/modules/evals/routes.ts`
- `server/src/modules/evals/helpers.ts`
- `server/src/modules/evals/reference-prompt.ts`
- `server/src/modules/evals/constants.ts`
- `server/src/platform/container.ts` (add `evalsRepo` getter, mirroring `agentsRepo`/`reviewRepo`)
- `server/src/modules/index.ts` (register `evals` plugin)
- `server/src/modules/reviews/routes.ts` (add `POST /findings/:id/eval-case`)
- `server/src/modules/agents/repository.ts` (add `listVersions(agentId): Promise<AgentVersionSummary[]>` — Q9, needed for AC-20)
- `server/src/modules/agents/service.ts` (expose `listVersions`)
- `server/src/modules/agents/routes.ts` (add `GET /agents/:id/versions`)
- `server/src/vendor/shared/contracts/knowledge.ts` (add `AgentVersionSummary`)
- `client/src/vendor/shared/contracts/knowledge.ts` (mirror `AgentVersionSummary`)

**Details:**

Routes (all under `server/src/modules/evals/routes.ts` unless noted):
- `POST /eval-cases` — body `EvalCaseInput` → insert, return `EvalCase` (AC-2). Provenance text goes only into `notes`.
- `GET /eval-cases?owner_kind&owner_id` → `EvalCase[]`
- `GET /eval-cases/:id` → `EvalCase`
- `PATCH /eval-cases/:id` → `EvalCase`
- `DELETE /eval-cases/:id` → `204` (cascade to `eval_runs` already in schema)
- `POST /eval-cases/:id/run` — resolve owner; if `owner_kind==='agent'`: load agent, `diff = parseUnifiedDiff(case.input_diff)` (reuse `server/src/adapters/git/diff-parser.ts`), call `reviewPullRequest({ systemPrompt: agent.systemPrompt, model: agent.model, diff, llm: await container.llm(agent.provider), prDescription: case.input_meta?.pr_body, task: \`Review: ${case.input_meta?.pr_title ?? case.name}\` })` (exactly 1 LLM call — AC-5), score via `scoring.ts`, insert one `eval_runs` row with a **new** `batch_id` (single-case batch) and `agent_version = agent.version`. If `owner_kind==='skill'`, delegate to the skill-run path described below (still reachable via this single-case endpoint, still 2 LLM calls).
- `POST /agents/:id/eval-runs` ("Run all evals") — one shared `batch_id` for all of the agent's `eval_cases`; macro-average aggregate (mean of per-case metrics — **not** re-summed TP/FP/FN) → `{ summary: EvalBatchSummary, runs: EvalRunResult[] }` (AC-6, AC-7).
- `POST /skills/:id/eval-runs` — `resolveFeatureModelStrict(container, workspaceId, "eval")` (throws `ValidationError` if unset → route must translate to a clean 4xx, not 500 — AC-26; locate the existing `resolveFeatureModelStrict` implementation and usage pattern by reading how the `onboarding` module already calls it, per `server/docs/api-contracts.md`'s mention of the 422 "no model configured" behavior — mirror that exact pattern). For each skill case: with-skill call `reviewPullRequest({ systemPrompt: \`${REFERENCE_PROMPT}\n\n${skill.body}\`, model, diff, llm })`, without-skill call `reviewPullRequest({ systemPrompt: REFERENCE_PROMPT, model, diff, llm })` (2 LLM calls per case — AC-24). Score both. `pass` via `computeSkillPass` (AC-27). Persist **one** `eval_runs` row per case: top-level `recall`/`precision`/`citation_accuracy` = the with-skill result; `actual_output = { with: {...}, without: {...} }`; `duration_ms`/`cost_usd` = sum of both calls; `agent_version = null` (Q6). One shared `batch_id` for the whole skill run.
- `GET /agents/:id/eval-dashboard` and `GET /skills/:id/eval-dashboard` → `EvalDashboard` (same shape, reused as-is per AC-29/Q7). `current` = latest batch's macro-average aggregate (or, for skills, the with-skill aggregate — Q7). `delta` = last batch minus second-to-last (0/pass-through when <2 batches exist — client decides whether to render arrows per AC-18, not this field alone). `trend` = one `EvalTrendPoint` per **batch** (not per raw run) for that owner, chronological. `recent_runs` = raw `EvalRunRecord[]` for that owner (existing shape, most recent first, capped at N=20). `alert` per the algorithm below (AC-19).
- `GET /eval-dashboard` → `EvalDashboardOverview` (Q1): `agents` = one `EvalDashboard` per agent in the workspace (including agents with 0 cases/0 runs — AC-13/14); `recent_runs` = flat cross-agent list of the most recent N=20 `EvalBatchSummary` rows across all agents, sorted desc by `ran_at` (AC-14/15).
- `POST /eval-runs/all` — only `enabled=true` agents with `eval_cases.count > 0` (repository needs a case-count-per-agent query to filter); silently skip 0-case agents; return one `EvalBatchSummary` per agent actually run (AC-16).
- `POST /findings/:id/eval-case` (in **`reviews/routes.ts`**, calling a new `EvalsService` method — instantiate `new EvalsService(app.container)` the same way `reviews/routes.ts` already instantiates `new ReviewService(container)`): look up the finding + its review + PR diff; build `EvalCaseInput` WITHOUT inserting: for an accepted finding, `expected_output = [{file, start_line, end_line, severity, category, title}]` (one entry from the finding itself); for a dismissed finding, `expected_output = []`. `input_diff`: reuse `sliceDiff` from `@devdigest/reviewer-core` (already does exactly the file-scoped diff slicing the spec's "diff-slice.ts" edge case describes — do not write a new diff-slicing implementation) on the PR's full parsed diff for `finding.file`; **but** explicitly check `diff.files.some(f => f.path === finding.file)` first — if the file is not present, override to `input_diff: ''` (empty), because `sliceDiff`'s own fallback returns the **whole raw diff** when the file isn't found, which does not match the spec's edge case ("file missing → empty `input_diff`, user edits manually"). Return the built `EvalCaseInput` directly (404 if finding not found; do not require the finding to be unresolved — only resolved findings reach this via the disabled-button gating on the client, AC-8/9).
- `GET /agents/:id/versions` (in `agents/routes.ts`) → `AgentVersionSummary[]` from `agent_versions`, mirroring `GET /skills/:id/versions`'s existing pattern (Q9, needed by `CompareRunsModal`, AC-20).

**Alert algorithm (AC-19, resolves the "notable shift" ambiguity):**
1. Find the last two distinct `batch_id`s for the owner, ordered by `ran_at` desc.
2. If fewer than 2 batches exist → `alert = null`.
3. For each `case_id` present in **both** batches, compare `pass` between the two runs.
4. If any case's `pass` differs, pick the first such case (ordered by case `name` ascending, for determinism) and build the templated string:
   - `must_not_flag` case whose `pass` went `true → false`: "New false positive: case '<name>' now flags a finding it previously didn't."
   - `must_find` case whose `pass` went `true → false`: "Regression: case '<name>' no longer finds the expected issue."
   - (the reverse, `false → true`, is an improvement — no alert)
5. If no case's `pass` differs → `alert = null`.

**Acceptance Criteria:**
- [ ] AC-009: all 12 routes above exist, validated by Zod schemas, return the documented shapes — maps to R2, R5, R6, R13-R16, R19-R21 (route existence)
- [ ] AC-010: `POST /eval-cases/:id/run` for an agent case makes exactly 1 LLM call and persists `batch_id`+`agent_version` — maps to R5
- [ ] AC-011: `POST /agents/:id/eval-runs` on ≥8 seeded mixed cases, prompt edited between two calls, shows different `recall`/`precision` across batches — maps to R7 (the AC-22/verify-l06 anchor test)
- [ ] AC-012: `POST /findings/:id/eval-case` never inserts a DB row; accepted → non-empty `expected_output`; dismissed → `[]`; file-not-in-diff → `input_diff: ''` — maps to R9
- [ ] AC-013: `POST /skills/:id/eval-runs` makes exactly 2 LLM calls per case; without a chosen `"eval"` model, returns a 4xx `ValidationError` body, never a 500 — maps to R24, R26
- [ ] AC-014: `GET /eval-dashboard` returns all workspace agents (incl. 0-case/0-run) and a flat, desc-sorted `recent_runs` — maps to R14
- [ ] AC-015: alert algorithm flips `alert` from `null` to a non-null case-referencing string when a seeded case's `pass` is made to flip between two batches — maps to R19
- [ ] AC-016: `GET /agents/:id/versions` returns each version's `system_prompt` — maps to R20 (Q9)

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-009 | `cd server && pnpm typecheck`; manual `curl` smoke pass for each route |
| AC-010, AC-013 | `.it.test.ts` with `MockLLMProvider` call counter assertion (`=== 1` / `=== 2`) |
| AC-011 | `.it.test.ts`: seed ≥8 cases, run batch #1, `PUT /agents/:id` with a different `system_prompt`, run batch #2, assert `recall_batch#1 !== recall_batch#2` — this is the exact test `scripts/verify-l06.sh` invokes |
| AC-012 | `.it.test.ts`: `POST /findings/:id/eval-case` on an accepted + a dismissed finding, assert no new `eval_cases` row and correct `expected_output` |
| AC-014 | `.it.test.ts`: seed 3 agents (0 agents with no cases, 1 with cases+no runs, 1 with runs), assert dashboard covers all 3 |
| AC-015 | `.it.test.ts`: two batches where one case's `pass` differs, assert `alert` references that case's name |
| AC-016 | `.it.test.ts`: `PUT /agents/:id` twice (2 versions), `GET /agents/:id/versions` returns 2 entries with correct prompts |

---

### TASK-004: Bonus — agent/skill list stats (lower priority, out of L06 grading rubric)

**Scope:** backend

**Owned Paths:**
- `server/src/modules/agents/repository.ts` (add `statsForWorkspace`)
- `server/src/modules/agents/service.ts` (wire into `list()`/`get()`)
- `server/src/modules/skills/repository.ts` (rewrite `listWithStats`, add `agentCountsForWorkspace`)
- `server/src/modules/skills/service.ts` (wire `list()` to use `listWithStats`)
- `server/src/vendor/shared/contracts/knowledge.ts` (add optional stat fields to `Agent` and `Skill`)
- `client/src/vendor/shared/contracts/knowledge.ts` (mirror)

**Details:**
- `AgentsRepository.statsForWorkspace(workspaceId): Promise<Map<string, {runsCount, acceptRatePct, avgCostUsd}>>` — ONE batched query (join `agent_runs`/`reviews`/`findings`, `GROUP BY agent_id`), no per-agent loop (Onion rule: no N+1). `accept_rate` = % of **findings** with `acceptedAt != null` among all resolved findings (`acceptedAt != null OR dismissedAt != null`) for that agent's reviews — finding-level, not verdict-level (AC-30's explicit clarification).
- Add optional fields to `Agent` (knowledge.ts): `runs_count?: number`, `accept_rate_pct?: number`, `avg_cost_usd?: number | null` — same additive-optional pattern as the existing `skill_count?: number` field, so no existing fixture breaks.
- `AgentsService.list()`/`get()`: attach these via `statsForWorkspace()` (list) / a single-agent equivalent (get), same pattern already used for `skill_count`.
- `SkillsRepository.listWithStats()`: currently computes real `agent_count` but hardcodes `pull_frequency_pct`/`accept_rate_pct` to `0`. Replace those two with the **same formulas** already implemented (correctly) in the existing singular `stats()` method, but computed **batched** across all workspace skills in one/few queries (`GROUP BY skill.id`), not per-skill. Extract the existing inline `agent_count` subquery into a new `agentCountsForWorkspace(workspaceId): Promise<Map<string, number>>`, mirroring `AgentsRepository.skillCountsForWorkspace()` naming for consistency; `listWithStats` calls it internally.
- Add optional fields to `Skill` (knowledge.ts): `agent_count?: number`, `pull_frequency_pct?: number`, `accept_rate_pct?: number`.
- `SkillsService.list()`: switch from the current `repo.list()` to `repo.listWithStats()`, mapping the wrapper `{skill, agent_count, pull_frequency_pct, accept_rate_pct}` into the extended `Skill` DTO.

**Acceptance Criteria:**
- [ ] AC-017: `GET /agents` for a workspace with multiple agents makes exactly ONE additional stats query (not one per agent) — maps to R30
- [ ] AC-018: `GET /skills` returns real, non-zero `agent_count`/`pull_frequency_pct`/`accept_rate_pct` (matching what `GET /skills/:id/stats` computes for the same skill) in one batched query — maps to R31

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-017 | `.it.test.ts`: seed N agents with runs/findings, assert query-count instrumentation (or SQL log inspection) shows 1 stats query regardless of N |
| AC-018 | `.it.test.ts`: seed a skill with known accepted/dismissed findings + PR coverage, assert `GET /skills` numbers match `GET /skills/:id/stats` for the same skill |

---

### TASK-005: Frontend — api.ts + hooks

**Scope:** frontend

**Owned Paths:**
- `client/src/lib/api.ts`
- `client/src/lib/hooks/evals.ts` (new)
- `client/src/lib/hooks/index.ts` (barrel — add export)

**Details:**
- `api.ts`: add fetch functions for all `evals` routes from TASK-003 (`fetchEvalCases`, `createEvalCase`, `updateEvalCase`, `deleteEvalCase`, `runEvalCase`, `runAgentEvals`, `runSkillEvals`, `runAllEvalsForWorkspace`, `fetchEvalDashboard` (agent/skill), `fetchEvalDashboardOverview`, `prefillEvalCaseFromFinding`, `promoteAgentPrompt` (thin wrapper over the existing `PUT /agents/:id` — Q8), `fetchAgentVersions`) — follow the exact typed-function style already in `api.ts` (see `fetchSmartDiff`, `postPrBrief`).
- `client/src/lib/hooks/evals.ts` (new file, following `agents.ts`/`skills.ts`'s query/mutation pairing pattern exactly): `useEvalCases(ownerKind, ownerId)`, `useCreateEvalCase()`, `useUpdateEvalCase()`, `useDeleteEvalCase()`, `useRunEvalCase()`, `useRunAgentEvals(agentId)`, `useRunSkillEvals(skillId)`, `useEvalDashboard(ownerKind, ownerId)`, `useEvalDashboardOverview()`, `usePrefillEvalCase()`, `usePromoteAgentPrompt(agentId)`, `useAgentVersions(agentId)`. Mutations invalidate the relevant dashboard/case-list query keys on success (matching `agents.ts`'s `invalidateQueries` + `setQueryData` pairing).
- All new imports use the `@/` alias (per stored project convention), not deep relative paths — do not replicate `FindingsPanel.tsx`'s existing 7-level relative import when adding new imports here.

**Acceptance Criteria:**
- [ ] AC-019: every route added in TASK-003 has a corresponding typed `api.ts` function and a TanStack Query hook
- [ ] AC-020: mutation hooks invalidate the correct query keys (verified by component tests in Phase 4 that assert refetch after a mutation)

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-019, AC-020 | `cd client && pnpm typecheck`; component tests in Phase 4 exercising each hook via mocked `fetch` |

---

### TASK-006: `EvalsTab` + `EvalCaseModal` + `AgentEditor`/`SkillEditor` wiring

**Scope:** frontend

**Owned Paths:**
- `client/src/components/evals/EvalsTab/` (new)
- `client/src/components/evals/EvalCaseModal/` (new)
- `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`
- `client/src/app/agents/[id]/page.tsx` (the separate `VALID_TABS` array)
- `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`
- `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx` (both the `TABS` import-based `VALID_TABS` guard AND the inline `TAB_DEFS` array + render switch)
- `client/messages/en/eval.json` (additive — new keys for skill with/without labels, tab label if missing; coordinate incrementally with TASK-008, see Architecture Notes)

**Details:**
- `EvalsTab` is **one** component taking `{ ownerKind: 'agent' | 'skill'; ownerId: string }` props (AC-23). Renders: case list (name, last-run pass/fail, recall%), "New case" button, aggregated metric tiles (`useEvalDashboard(ownerKind, ownerId)`). For `ownerKind==='agent'`: also render a "View full dashboard →" link to `/eval/[agentId]` (AC-28). For `ownerKind==='skill'`: do NOT render trend chart / run-history table / `CompareRunsModal` / Promote button / dashboard link (AC-28) — render with/without labeled tiles instead (Q7: both driven from `current`, since only one aggregate is exposed; the per-case list rows for skills additionally show with/without numbers pulled from each case's last run `actual_output.with`/`.without`).
- `EvalCaseModal`: prefilled from either "New case" (blank) or `usePrefillEvalCase()` (Turn-into-eval-case flow, AC-9). Computed (not stored) POSITIVE/NEGATIVE banner from `expected_output.length` (AC-10) using the exact same `caseTypeOf` derivation logic as the server (mirror the one-line check, do not invent a different rule).
- `AgentEditor`: add `"evals"` to **three** places — `AgentEditor/constants.ts` `TABS` array, the render switch in `AgentEditor.tsx` (`{tab === "evals" && <EvalsTab ownerKind="agent" ownerId={agent.id} />}`), and the separately-declared `VALID_TABS` in `agents/[id]/page.tsx` (do not miss this third spot — it validates the `?tab=` query param independently of `constants.ts`).
- `SkillEditor`: add `"evals"` to **both** `constants.ts`'s `TABS` (used only for the `VALID_TABS` guard) and the inline `TAB_DEFS` array + render switch inside `SkillEditor.tsx` itself (this file does not currently generate its tab bar from `constants.ts`, unlike `AgentEditor` — three total edit points across two files, per the researcher's finding).
- New "Evals" tab label goes through `useTranslations()` in both editors — `SkillEditor.tsx`'s existing `TAB_DEFS` hardcodes English labels for its other tabs (a pre-existing i18n-rule violation); do not compound it for the new tab even though existing tabs are already inconsistent — flag this existing inconsistency but only fix it for the new tab being added.

**Acceptance Criteria:**
- [ ] AC-021: the identical `EvalsTab` component renders correctly under both `AgentEditor` (with dashboard link, full tiles) and `SkillEditor` (no trend/history/Compare/Promote, with/without tiles) — maps to R23, R28
- [ ] AC-022: `EvalCaseModal` shows POSITIVE banner when `expected_output.length>0`, NEGATIVE when `===0` — maps to R10
- [ ] AC-023: navigating to `/agents/:id?tab=evals` and `/skills/:id?tab=evals` both render without a "invalid tab" fallback

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-021 | RTL component test: render `<EvalsTab ownerKind="skill" .../>`, assert absence of trend/Compare/Promote; render with `ownerKind="agent"`, assert link presence |
| AC-022 | RTL component test: mock `expected_output` both ways, assert banner text |
| AC-023 | RTL test on `AgentEditor`/`SkillEditor` with `?tab=evals` |

---

### TASK-007: `FindingCard` "Turn into eval case"

**Scope:** frontend

**Owned Paths:**
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
- `client/messages/en/eval.json` (additive — button label, if not already present)

**Details:**
- Add a third `<Button>` inside the existing `s.actions` div in `FindingCard.tsx` (alongside Accept/Dismiss), disabled unless `f.accepted_at != null || f.dismissed_at != null` (AC-8). New prop `onCreateEvalCase?: (f: FindingRecord) => void` (a separate callback, not overloading the existing `onAction: (action: FindingActionKind) => void` which is typed to accept/dismiss only).
- `FindingsPanel.tsx` wires `onCreateEvalCase` to `usePrefillEvalCase()` (TASK-005) → on success, open `EvalCaseModal` (TASK-006) pre-filled with the returned `EvalCaseInput`.
- When adding new imports here, use the `@/` alias — do not extend the existing 7-level relative import to `lib/hooks/reviews`; import the new eval hook via `@/lib/hooks/evals`.

**Acceptance Criteria:**
- [ ] AC-024: button is enabled only for resolved findings, disabled otherwise — maps to R8
- [ ] AC-025: clicking it on an accepted finding opens `EvalCaseModal` with non-empty `expected_output`; on a dismissed finding, with empty `expected_output` — maps to R9

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-024 | RTL component test: render `FindingCard` with/without `accepted_at`/`dismissed_at`, assert disabled state |
| AC-025 | RTL component test: mock `usePrefillEvalCase`, assert modal receives the right `expected_output` shape |

---

### TASK-008: Eval Dashboard pages + `CompareRunsModal` + LCS diff utility

**Scope:** frontend

**Owned Paths:**
- `client/src/app/eval/page.tsx` (new — landing)
- `client/src/app/eval/[agentId]/page.tsx` (new — detail)
- `client/src/components/evals/EvalDashboardTable/` (new — landing table: agent rows, "Not run yet" / muted "0 eval cases" states, AC-13)
- `client/src/components/evals/MetricCard/` (new, or reuse an existing generic card primitive if one exists — check `components/ui/` first per frontend-architecture conventions)
- `client/src/components/evals/RunsTable/` (new — checkboxes, max 2 selected, "X/Y" pass column, cost column)
- `client/src/components/evals/CompareRunsModal/` (new)
- `client/src/lib/diff/lcs-diff.ts` (new — pure LCS line-diff utility)
- `client/messages/en/eval.json` (additive — landing/detail/compare/promote strings not yet present, e.g. "Run all agents", "Promote", alert banner copy)

**Details:**
- `/eval` (landing): `useEvalDashboardOverview()`. Renders every agent (AC-13): 0 runs → "Not run yet" + flat sparkline; 0 cases → muted "0 eval cases · configure to get started" row, no metrics; row click → `/eval/[agentId]`. "Run all agents" button → `POST /eval-runs/all`. `recent_runs` section: `EmptyState` "No eval runs yet" when `[]` (AC-15).
- `/eval/[agentId]` (detail): `useEvalDashboard('agent', agentId)`. 3 `MetricCard`s (Recall/Precision/Citation) with delta arrows computed from `dashboard.trend` — arrows shown **only** when `trend.length >= 2` (AC-18); "TRACES PASSED" card/column never shows a delta arrow regardless of batch count (AC-18). `LineChart` with 3 series from `trend` (one point per batch). `RunsTable`: checkboxes capped at 2 selections, `pass` column as `"X/Y"` (traces_passed/traces_total), `cost` column = batch's summed `cost_usd`.
- `CompareRunsModal`: on 2 selected runs, fetch both `agent_versions`' `system_prompt` via `useAgentVersions(agentId)` (TASK-005/Q9), pass the two prompt strings into `lcs-diff.ts`'s `buildPromptDiffPatch(oldPrompt, newPrompt): string` (produces unified-diff-formatted text compatible with the existing `parsePatch()` in `client/src/components/diff-viewer/helpers.ts` — **read that file first** to match its exact expected hunk-header/line-prefix format before writing the LCS output), then `parsePatch(patch)` → `Line[]` → render each via the existing `<CodeLine>` component. `CodeLine` requires non-optional `path` and `threads` props — pass a placeholder `path="system_prompt"` and `threads={[]}`, omit `commenting`/`badge`/`targetLine`. Also render metric deltas (recall/precision/citation/cost, old→new, colored arrows) above the diff. "Promote {version}" button: calls `usePromoteAgentPrompt(agentId)` → `PUT /agents/:id` with `{ system_prompt: selectedVersionPrompt }` only (Q8 — there is no separate `PATCH` route); disabled when the selected version's number equals the agent's current `version` (AC-21).

**Acceptance Criteria:**
- [ ] AC-026: `/eval` shows every agent, correct placeholders for 0-run/0-case, `EmptyState` when `recent_runs=[]` — maps to R13, R15
- [ ] AC-027: `/eval/[agentId]` shows deltas only with ≥2 batches; "TRACES PASSED" never has a delta — maps to R17, R18
- [ ] AC-028: `CompareRunsModal` renders a line-level +/- diff via `CodeLine` for two different prompts, and metric deltas — maps to R20
- [ ] AC-029: Promote button disabled iff selected version === current agent version; otherwise sends `PUT /agents/:id` with only `system_prompt` — maps to R21

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-026 | RTL component test with mocked `EvalDashboardOverview` fixtures (0-run agent, 0-case agent, normal agent, empty `recent_runs`) |
| AC-027 | RTL component test with mocked `EvalDashboard` fixtures (1 batch vs 2+ batches) |
| AC-028 | RTL component test: two different `system_prompt` strings in, assert `CodeLine` renders `add`/`del` kinds |
| AC-029 | RTL component test: `selectedRun.agent_version === agent.version` → button `disabled`; else assert the `PUT` mock call body |

---

### TASK-009: Bonus — `AgentCard`/`SkillCard` stats rows (lower priority)

**Scope:** frontend

**Owned Paths:**
- `client/src/app/agents/_components/AgentCard/AgentCard.tsx`
- `client/src/app/skills/_components/SkillCard/SkillCard.tsx`

**Details:**
- `AgentCard`: render a bottom stats row "N runs · X% accept · $Y avg" from `ag.runs_count`/`ag.accept_rate_pct`/`ag.avg_cost_usd` (TASK-004's new optional `Agent` fields) — omit the row gracefully when these are `undefined` (agents fetched from older cached responses / tests without the fields).
- `SkillCard`: render "N agents" badge + "X% pull · Y% accept" row from `skill.agent_count`/`skill.pull_frequency_pct`/`skill.accept_rate_pct`.

**Acceptance Criteria:**
- [ ] AC-030: `AgentCard` with stats fields present shows the formatted row — maps to R30
- [ ] AC-031: `SkillCard` with stats fields present shows the badge + row — maps to R31

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-030 | RTL component test with a mocked `Agent` fixture including stats fields |
| AC-031 | RTL component test with a mocked `Skill` fixture including stats fields |

---

### TASK-010: `scripts/verify-l06.sh`

**Scope:** backend (root-level script; written last, after Phase 4 tests exist)

**Owned Paths:**
- `scripts/verify-l06.sh` (new)

**Details:**
- Follows the exact style of `scripts/dev.sh`/`scripts/e2e.sh`: `set -euo pipefail`, resolve `ROOT`, `log()`/`warn()` helpers, `trap` is not needed here (no long-lived processes). Sequential steps, each aborting the script on failure (`set -e` handles this without extra plumbing since each step is a plain `(cd dir && command)`):
  1. `(cd server && pnpm typecheck)`
  2. `(cd client && pnpm typecheck)`
  3. `(cd server && pnpm exec vitest run src/modules/evals/scoring.test.ts)` (hermetic)
  4. `(cd server && pnpm exec vitest run <the AC-7/AC-011 integration test file>.it.test.ts)` (requires Postgres — document in the script header that this needs a running/testcontainers-managed Postgres, same requirement as any other `.it.test.ts`)
- Exits 0 iff all four steps succeed; any failing step aborts with its own nonzero exit code (no swallowing).

**Acceptance Criteria:**
- [ ] AC-032: `./scripts/verify-l06.sh` exits 0 when everything is green — maps to R22
- [ ] AC-033: intentionally breaking one step (e.g. a typecheck error) makes the script exit nonzero — maps to R22

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-032 | `./scripts/verify-l06.sh` → `echo $?` → `0` |
| AC-033 | temporarily introduce a type error, rerun, confirm nonzero exit, then revert |

---

## Implementation Phases

> ⚙️ Execution mode: **multi-agent** — backend implementer runs TASK-001 → 002 → 003 → 004 → 010 sequentially; frontend implementer runs TASK-005 → 006 → 007 → 008 → 009 sequentially; the two streams run **in parallel** with each other (owned paths never cross between the two sets).

### Phase 1: DB / Schema
- [ ] TASK-001: `pnpm db:generate` after `eval.ts` schema change → review generated `0018_*.sql`
- [ ] TASK-001: `pnpm db:migrate`

### Phase 2: Backend (parallel with Phase 3)
- [ ] TASK-001: shared contracts (`eval-ci.ts`, `platform.ts`) + reviewer-core `rangesOverlap`
- [ ] TASK-002: `modules/evals/scoring.ts`
- [ ] TASK-003: `modules/evals/{repository,service,routes,helpers,reference-prompt,constants}.ts` + `container.ts` + `modules/index.ts` + `reviews/routes.ts` addition + `agents` versions endpoint
- [ ] TASK-004: bonus stats (`agents`/`skills` repository+service, `knowledge.ts` fields)

### Phase 3: Frontend (parallel with Phase 2)
- [ ] TASK-005: `lib/api.ts` + `lib/hooks/evals.ts`
- [ ] TASK-006: `components/evals/{EvalsTab,EvalCaseModal}` + `AgentEditor`/`SkillEditor` wiring
- [ ] TASK-007: `FindingCard`/`FindingsPanel` "Turn into eval case"
- [ ] TASK-008: `/eval` pages + `CompareRunsModal` + `lib/diff/lcs-diff.ts`
- [ ] TASK-009: bonus `AgentCard`/`SkillCard` stats rows

### Phase 4: Tests (after Phase 2 + 3 land)
- [ ] `server/src/modules/evals/scoring.test.ts` — hermetic (AC-3/4/11/12/27, LLM-call-counter = 0)
- [ ] `server/src/modules/evals/evals.it.test.ts` — integration: AC-5/6/7/14/16/19/24/26 (real Postgres, seeds ≥8 mixed cases for the AC-7 prompt-shift assertion)
- [ ] `server/src/modules/agents/agents-stats.it.test.ts` — AC-30 (bonus, batched query assertion)
- [ ] `server/src/modules/skills/skills-stats.it.test.ts` — AC-31 (bonus, batched query assertion)
- [ ] `client/.../FindingCard.test.tsx`, `FindingsPanel.test.tsx` — AC-8/9
- [ ] `client/.../EvalCaseModal.test.tsx` — AC-10
- [ ] `client/.../EvalsTab.test.tsx` — AC-23/28 (both `ownerKind`s)
- [ ] `client/app/eval/page.test.tsx`, `client/app/eval/[agentId]/page.test.tsx` — AC-13/14/15/17/18
- [ ] `client/.../CompareRunsModal.test.tsx` — AC-20/21
- [ ] `client/.../AgentCard.test.tsx`, `SkillCard.test.tsx` — AC-30/31 (bonus)
- [ ] TASK-010: `scripts/verify-l06.sh` wired to run the above — AC-22

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `rangeIntersects` in `reviewer-core/grounding.ts` doesn't match AC-3's described semantics and isn't exported | Add a new, separately-named `rangesOverlap` two-range primitive (Q5); zero change to existing `groundFindings` behavior |
| `eval_runs` schema has only one metric-column set, but skill runs need with/without pairs (AC-24) | Store both pairs in `actual_output` jsonb; top-level columns mirror the with-skill result (Q6) — documented, not left to implementer guesswork |
| Spec says Promote uses "existing PATCH /agents/:id" — no such route exists | Use the actual existing `PUT /agents/:id` (already partial-update via optional fields) (Q8) |
| AC-20 needs old `system_prompt` text per `agent_version`, no endpoint currently exposes it | Add `GET /agents/:id/versions` mirroring the skills pattern (Q9) |
| `sliceDiff`'s own fallback returns the WHOLE raw diff (not empty) when a file isn't found — contradicts the spec's "file missing → empty `input_diff`" edge case | Explicitly check file presence in the finding-prefill logic before trusting `sliceDiff`'s fallback (TASK-003) |
| Skill-case pass formula (AC-27) is explicitly pinned as v1/tunable-later in the spec | Implement literally as specified now (Q2); do not attempt to guess a numeric threshold — flagged as a known future-tuning item, out of this plan's scope |
| `SkillEditor.tsx`'s tab bar is NOT generated from its own `constants.ts` (unlike `AgentEditor`) — three edit points across two files instead of two | Called out explicitly in TASK-006 so the frontend implementer doesn't miss the inline `TAB_DEFS` array |
| `agents/[id]/page.tsx` has an independent, duplicate `VALID_TABS` array from `AgentEditor/constants.ts` | Called out explicitly in TASK-006 as a third required edit point |
| `evals/` at repo root is a same-named but **unrelated** package (L06 meta-eval harness for this repo's own Claude Code skills/agents) | Confirmed via coordinator + git log (`0d39cf1`/`5921c20`); the new verify script lives at `scripts/verify-l06.sh`, never touching `evals/package.json` (Q3) |
| `client/src/vendor/shared/` is a manually-mirrored copy, not a symlink | Every contract change in TASK-001/003/004 lists the client mirror file explicitly as an owned path |
| Multiple tasks touch the same additive files (`eval-ci.ts`, `knowledge.ts`, `platform.ts`, `eval.json`) within the same implementer stream | Acceptable — these are sequential edits by the same implementer instance, not cross-stream parallel conflicts; only backend-vs-frontend owned-path overlap is prohibited by the multi-agent execution mode |

## Out of Scope
- Numeric-threshold tuning of the skill pass formula (AC-27) — v1 boolean gate only, per spec's own [NEEDS CLARIFICATION]
- Any new DB table for batch/summary data — `EvalBatchSummary` is always computed by aggregation, never persisted
- `/eval/[skillId]` detail dashboard page, skill `CompareRunsModal`, skill Promote — explicitly non-goals in the spec
- A11y — out of scope for this project per standing project convention
- Editing anything inside the unrelated `evals/` root package

## Architecture Notes
- **Onion layering for `modules/evals/`**: `routes.ts` validates + calls `service.ts` only; `service.ts` orchestrates `repository.ts` + `reviewer-core.reviewPullRequest` + `scoring.ts`, no SQL; `repository.ts` is the only file with Drizzle queries; `scoring.ts` is pure domain logic (no DB/Fastify/LLM imports at all) — mirrors the `reviews/` module's existing split (`ReviewService` → `ReviewRepository` + `ReviewRunExecutor`).
- **DI**: `evalsRepo` getter added to `container.ts` exactly like `agentsRepo`/`reviewRepo`/`skillsRepo` (lazy `??=` construction). `EvalsService` is instantiated directly inside `routes.ts` (`new EvalsService(app.container)`), matching every other module's route-file pattern — not stored on the container (only repositories are).
- **Cross-module reads**: `evals` reads `agents` and `skills` exclusively via `container.agentsRepo`/`container.skillsRepo` (already public on the container) — never reaches into `modules/agents/repository.ts` or `modules/skills/repository.ts` directly from `evals/service.ts`.
- **`reviewPullRequest` reuse**: both agent-case runs and skill-case runs (with/without) call the exact same `reviewPullRequest` from `@devdigest/reviewer-core` — no bespoke LLM-calling code in the evals module. `groundFindings` runs unconditionally inside `reviewPullRequest` itself; `citation_accuracy` is derived from its `dropped` array, never a second grounding pass (AC-12).
- **`diff-slice.ts` naming**: the spec names a conceptual `diff-slice.ts` helper; the actual implementation reuses reviewer-core's existing exported `sliceDiff` (from `review/reduce.ts`) rather than a new file of that name — no new file is needed for this specific responsibility, just the file-presence guard noted in TASK-003/Risks.
- **Untrusted input handling**: `input_diff`, `input_meta.pr_title`/`pr_body`, and `skill.body` all flow into `reviewPullRequest`'s existing `diff`/`prDescription`/`skills` parameters, which are already wrapped by `wrapUntrusted()` + the `INJECTION_GUARD` inside `assemblePrompt()` — no new prompt-injection surface is introduced by this feature; nothing in the evals module needs its own untrusted-content handling beyond passing strings through the existing pipeline unchanged.
