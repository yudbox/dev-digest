# Plan: Skill-eval strategy registry — fix rubric-type vacuous pass + Code-tab / Actual-output UI

> Status: DRAFT
> Created: 2026-07-07
> Source design (approved): `~/.claude/plans/mutable-seeking-blum.md`

## Problem

Rubric-type skill eval cases (only `pr-quality-rubric` today) always report 100% recall/precision and pass, because `parseExpectedOutput` (`server/src/modules/evals/helpers.ts:26-29`) silently coerces the rubric-shaped `expected_output` (`{dimension,score,reason}[]`) into `[]` when it fails `ExpectedFinding[]` validation. Empty expected → `recall = 1.0`; the rubric LLM path was never exercised so actual is empty too → `precision = 1.0`. Both sides pass vacuously.

The fix is architectural, not a one-off `if`: a strategy registry keyed by the existing `skills.type` enum. `rubric` gets a new single-call (no with/without) execution + a dimension-name scoring predicate; `convention`/`security`/`custom` keep the existing with/without finding-grounded logic, extracted into a registry object. Two UI redesigns ride along: a `Code` tab (New/Modified toggle + Before/After textareas → auto-generated diff via the existing LCS util, with a hidden constant file path) replacing raw diff entry for manually-written skill cases, and a read-only `Actual output` panel below a height-halved `Expected output` panel.

No DB migration: reuses `skills.type`, and existing `eval_cases`/`eval_runs` columns exactly (`citation_accuracy` already nullable, `actual_output` already jsonb).

## Affected Modules

| Module | Path | Change Type |
|--------|------|-------------|
| backend: shared contracts | `server/src/vendor/shared/contracts/eval-ci.ts` | Modify (add `RubricAssessment`) |
| backend: `evals` constants | `server/src/modules/evals/constants.ts` | Modify (add file-path constant) |
| backend: `evals` scoring | `server/src/modules/evals/scoring.ts` | Modify |
| backend: `evals` helpers | `server/src/modules/evals/helpers.ts` | Modify |
| backend: `evals` strategies | `server/src/modules/evals/skill-eval-strategies.ts` | Add (new file) |
| backend: `evals` service | `server/src/modules/evals/service.ts` | Modify |
| backend: `evals` tests | `server/src/modules/evals/{scoring.test.ts,evals.it.test.ts}` | Modify |
| frontend: shared contract mirror | `client/src/vendor/shared/contracts/eval-ci.ts` | Modify (mirror `RubricAssessment`) |
| frontend: i18n | `client/messages/en/eval.json` | Modify |
| frontend: Code-tab component | `client/src/components/evals/EvalCaseModal/CodeInput.tsx` (+ `snippet-diff.ts`) | Add (new files) |
| frontend: case modal | `client/src/components/evals/EvalCaseModal/{EvalCaseModal.tsx,helpers.ts}` | Modify |
| frontend: evals tab | `client/src/components/evals/EvalsTab/EvalsTab.tsx` | Modify |
| frontend: skill editor | `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx` | Modify |

> **Owned-path safety:** no file below appears in two parallel tasks. Where a dependency exists (e.g. contract → consumers) it is called out as a sequencing note, not a shared file.

---

## Tasks

### TASK-001: Backend contract + constants (`RubricAssessment`, hidden file path)

**Scope:** backend

**Owned Paths:**
- `server/src/vendor/shared/contracts/eval-ci.ts`
- `server/src/modules/evals/constants.ts`

**Details:**
- In `eval-ci.ts`, add **additively** next to `ExpectedFinding`:
  ```ts
  export const RubricAssessment = z.object({
    dimension: z.string(),
    score: z.number(),
    reason: z.string(),
  });
  export type RubricAssessment = z.infer<typeof RubricAssessment>;
  ```
  Do not touch existing exports. `SkillType` is already available from `./knowledge.js` (`knowledge.ts:183`).
- In `constants.ts` (already exports `RECENT_RUNS_LIMIT`), add:
  ```ts
  export const MANUAL_SKILL_CASE_FILE_PATH = 'snippet.ts';
  ```
  This is the single hidden path used for all manually-written finding-grounded skill cases (`convention`/`security`/`custom`). Never surfaced in any DTO.

**Acceptance Criteria:**
- [ ] AC-001: `RubricAssessment` exported from `server/src/vendor/shared/contracts/eval-ci.ts`; `z.infer` type exported alongside.
- [ ] AC-002: `MANUAL_SKILL_CASE_FILE_PATH` exported from evals `constants.ts`; existing `RECENT_RUNS_LIMIT` untouched.
- [ ] AC-003: `pnpm typecheck` (server) passes with no new errors.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-001/002 | grep exports; `cd server && pnpm typecheck` |
| AC-003 | `cd server && pnpm typecheck` → 0 errors |

---

### TASK-002: Backend scoring + helpers (rubric scoring, `parseExpectedOutput` branch, file-path injection)

**Scope:** backend
**Depends on:** TASK-001 (imports `RubricAssessment`, `MANUAL_SKILL_CASE_FILE_PATH`)

**Owned Paths:**
- `server/src/modules/evals/scoring.ts`
- `server/src/modules/evals/helpers.ts`

**Details — `scoring.ts`:**
- Add non-exported `isRubricMatch(expected: RubricAssessment, actual: RubricAssessment): boolean` → `expected.dimension.trim().toLowerCase() === actual.dimension.trim().toLowerCase()`.
- Add `export function scoreRubricCase(expected: RubricAssessment[], actual: RubricAssessment[]): ScoreResult` — identical tp/fp/fn/recall/precision math to `scoreCase` (lines 50-62) but using `isRubricMatch` instead of `isMatch`. `score`/`reason` do NOT affect pass/fail (diagnostic only).
- `computePass` / `computeCitationAccuracy` unchanged (they already operate on any `ScoreResult`).
- `caseTypeOf` currently `(expected: ExpectedFinding[]): EvalCaseType` (line 36). Widen to accept `ExpectedFinding[] | RubricAssessment[]` (it only inspects `.length`, so behaviour is unchanged for both shapes). Keep `computeSkillPass` as-is (rubric never calls it).

**Details — `helpers.ts`:**
- Change signature to:
  ```ts
  export function parseExpectedOutput(
    raw: unknown,
    skillType?: SkillType,   // undefined => agent-owned => ExpectedFinding[]
  ): ExpectedFinding[] | RubricAssessment[]
  ```
  - `skillType === 'rubric'` → validate against `z.array(RubricAssessment)`.
  - `skillType` in `{'convention','security','custom'}` → **preprocess**: for each raw item lacking a `file` key, inject `file: MANUAL_SKILL_CASE_FILE_PATH` before validating against `z.array(ExpectedFinding)` (skeletons for manual skill cases omit `file` by design — see TASK-006/007).
  - `skillType === undefined` (agent) → validate against `z.array(ExpectedFinding)` with the real file preserved, no injection.
  - The silent `[]`-on-mismatch behaviour is preserved ONLY as a last-resort fallback; the primary defence against malformed input is now client-side live validation (TASK-007) against the correct schema, so a genuinely malformed save is caught before it reaches here.
- Update the in-file caller `computeAlert` (`helpers.ts:135-156`) — it calls `caseTypeOf(parseExpectedOutput(first.caseExpectedOutput))`. It must pass the owning skill's `type` for skill-owned batches. Thread a `skillType` through `computeAlert` / `buildDashboard` for skill owners (agents pass `undefined`). Any other `parseExpectedOutput` / `toEvalCaseDto` call sites in this file must pass `skillType` resolved from `owner_id → skills.type` for skill-owned rows.

**Acceptance Criteria:**
- [ ] AC-004: `scoreRubricCase` returns correct recall/precision on a fixture pair matched by dimension name (case/whitespace-insensitive), never calling an LLM.
- [ ] AC-005: `parseExpectedOutput(rubricRaw, 'rubric')` returns the parsed `RubricAssessment[]` (NOT `[]`) for the real `pr-quality-rubric` expected shape.
- [ ] AC-006: `parseExpectedOutput(skeletonWithoutFile, 'convention')` returns a valid `ExpectedFinding[]` with `file === 'snippet.ts'` injected.
- [ ] AC-007: `parseExpectedOutput(agentRaw)` (no `skillType`) is unchanged — real `file` preserved, no injection.
- [ ] AC-008: `caseTypeOf` accepts both `ExpectedFinding[]` and `RubricAssessment[]`; `computeSkillPass`/`computePass` unchanged.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-004/005/006/007 | `cd server && pnpm exec vitest run scoring.test.ts` (unit added in TASK-004) |
| AC-008 | `cd server && pnpm typecheck` + scoring unit test |

---

### TASK-003: Backend strategy registry + service branch point

**Scope:** backend
**Depends on:** TASK-001, TASK-002

**Owned Paths:**
- `server/src/modules/evals/skill-eval-strategies.ts` (new)
- `server/src/modules/evals/service.ts`

**Details — `skill-eval-strategies.ts` (new):**
- Define the strategy shape (design §"Рекомендуемый редизайн"):
  ```ts
  interface SkillEvalStrategy {
    usesDiff: boolean;                                   // drives UI tab visibility (surfaced via DTO/skill.type on client)
    execute(ctx): Promise<{ actualOutput: unknown; recall: number; precision: number; citationAccuracy: number | null }>;
    score?(...): ScoreResult;                            // rubric uses scoreRubricCase; finding-grounded reuses existing
  }
  ```
  `ctx` carries what the strategy needs so nothing private is reached into: `{ container, provider, model, skill, evalCase, wrappedBody, reviewPullRequest }`. (`wrappedBody` = output of `wrapSkillBodyIfUntrusted`, passed in — see Risks.)
- `findingGroundedStrategy` (`usesDiff: true`): move the existing `runOneSkillCase` body (`service.ts:309-409`, two `reviewPullRequest` calls with/without skill body, `computeSkillPass`, `computeCitationAccuracy`, `actualOutput = {with, without}`) into this object **verbatim in behaviour**. Registered for `convention`, `security`, `custom` (same object instance).
- `rubricStrategy` (`usesDiff: false`, new):
  1. Model already resolved by caller via `resolveFeatureModelStrict(container, workspaceId, 'eval')` (same `ValidationError`→4xx path).
  2. Build messages from `wrappedBody` + `evalCase.inputMeta.pr_title` / `pr_body`. No diff, no `reviewPullRequest`, no `groundFindings`.
  3. `const { data } = await provider.completeStructured({ schema: z.array(RubricAssessment), messages })` (first direct `completeStructured` caller in evals; port = `LLMProvider` at `adapters.ts:82-86`).
  4. `const score = scoreRubricCase(parseExpectedOutput(evalCase.expectedOutput, 'rubric') as RubricAssessment[], data)`.
  5. Return `{ actualOutput: data, recall: score.recall, precision: score.precision, citationAccuracy: null }`; `pass = computePass(caseTypeOf(expected), score)` (single run — `computeSkillPass` not called).
- `export const SKILL_EVAL_STRATEGIES: Record<SkillType, SkillEvalStrategy>` mapping `rubric→rubricStrategy`, `convention/security/custom→findingGroundedStrategy`.

**Details — `service.ts`:**
- In the skill-case run path (currently `runOneSkillCase`, called from `runSkillEvals:182-205`), replace the inline with/without logic with a single branch: look up `SKILL_EVAL_STRATEGIES[skill.type]`, compute `wrappedBody = this.wrapSkillBodyIfUntrusted(skill)`, call `strategy.execute(ctx)`, and persist the returned `{actualOutput, recall, precision, citationAccuracy, pass}` into `eval_runs` via the existing repository insert. The one branch point replaces logic previously spread across execute/score.
- `wrapSkillBodyIfUntrusted` (private, `service.ts:301-305`) and its untrusted-source guard MUST be preserved and applied to BOTH strategies (do not lose the security wrapping during refactor — it is exercised by an existing `evals.it.test.ts` security test).
- `prefillFromFinding`'s `owner_kind: 'agent'` hardcode (`service.ts:500`) stays — skill cases are authored manually only (design §"Нет кнопки авто-генерации").

**Acceptance Criteria:**
- [ ] AC-009: `SKILL_EVAL_STRATEGIES` maps all four `SkillType` values; `convention`/`security`/`custom` share one strategy instance.
- [ ] AC-010: Running a `convention`/`security`/`custom` skill case still issues exactly **2** `reviewPullRequest` calls and produces identical recall/precision/citation_accuracy/actual_output shape as before (no behavioural regression).
- [ ] AC-011: Running a `rubric` skill case issues exactly **1** `provider.completeStructured` call, **0** `reviewPullRequest` calls; persists `citation_accuracy = null` and `actual_output = RubricAssessment[]` (not `{with, without}`).
- [ ] AC-012: Untrusted-source skill body wrapping (`wrapSkillBodyIfUntrusted`) is applied in the rubric path too; existing security it-test still passes.
- [ ] AC-013: Missing `eval` feature model still yields a 4xx (`ValidationError`), never a 500, for the rubric path.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-009 | `cd server && pnpm typecheck` (exhaustive `Record<SkillType,...>`) |
| AC-010/011/012/013 | `cd server && pnpm exec vitest run evals.it.test.ts` |

---

### TASK-004: Backend tests (hermetic unit + integration)

**Scope:** backend
**Depends on:** TASK-002, TASK-003

**Owned Paths:**
- `server/src/modules/evals/scoring.test.ts`
- `server/src/modules/evals/evals.it.test.ts`

**Details:**
- `scoring.test.ts` (hermetic, zero LLM): add a `scoreRubricCase` describe block — matched/unmatched dimensions, case + whitespace insensitivity, `must_find` vs `must_not_flag` via `caseTypeOf` on `RubricAssessment[]`. Add a regression test proving `parseExpectedOutput(realRubricExpected, 'rubric')` no longer collapses to `[]`, and that `pass` varies with actual (not always true).
- `evals.it.test.ts` (real Postgres): seed a `rubric` skill + one POSITIVE and one NEGATIVE case; assert the run goes through `rubricStrategy` — **1** LLM call, `citation_accuracy` null, `actual_output` is a `RubricAssessment[]`. Keep/verify the existing finding-grounded skill test still asserts **2** LLM calls and the untrusted-body security test.

**Acceptance Criteria:**
- [ ] AC-014: New `scoreRubricCase` unit tests pass hermetically (no LLM).
- [ ] AC-015: Regression test asserts the original bug is fixed (valid `RubricAssessment[]` not collapsed; `pass` reflects model output).
- [ ] AC-016: Integration test asserts rubric run = 1 LLM call, `citation_accuracy = null`, `RubricAssessment[]` actual_output.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-014/015 | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' scoring.test.ts` → pass |
| AC-016 | `cd server && pnpm exec vitest run evals.it.test.ts` → pass |

---

### TASK-005: Frontend contract mirror + i18n keys

**Scope:** frontend

**Owned Paths:**
- `client/src/vendor/shared/contracts/eval-ci.ts`
- `client/messages/en/eval.json`

**Details:**
- Mirror `RubricAssessment` into the client contract (extensionless imports, matching the existing manual-mirror style). `SkillType` already exists in the client `knowledge.ts` mirror.
- Add i18n keys under `caseEditor` and `evalsTab` namespaces (no hardcoded JSX strings — project rule): e.g. `caseEditor.tabs.code`, `caseEditor.dimensionSkeleton`, `caseEditor.actualOutput`, `caseEditor.neverRunYet`, `caseEditor.codeMode.newFile`, `caseEditor.codeMode.modifiedFile`, `caseEditor.codeBefore`, `caseEditor.codeAfter`, `caseEditor.previewGeneratedDiff`, and `evalsTab.dimension`.

**Acceptance Criteria:**
- [ ] AC-017: `RubricAssessment` exported from client contract mirror; `client/ pnpm typecheck` passes.
- [ ] AC-018: All new i18n keys present in `client/messages/en/eval.json`; no other locale file exists to update (only `en/` present).

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-017 | `cd client && pnpm typecheck` |
| AC-018 | grep keys in `client/messages/en/eval.json` |

---

### TASK-006: Frontend Code-tab component + snippet diff builder

**Scope:** frontend
**Depends on:** TASK-005 (i18n keys)

**Owned Paths:**
- `client/src/components/evals/EvalCaseModal/CodeInput.tsx` (new)
- `client/src/components/evals/EvalCaseModal/snippet-diff.ts` (new)

**Details:**
- `snippet-diff.ts`: `export function buildSnippetDiff(before: string, after: string, path: string): string` — reuse the LCS core `diffLines(oldLines, newLines)` from `client/src/lib/diff/lcs-diff.ts` (do NOT edit that file), and emit a unified diff with header `--- a/${path}` / `+++ b/${path}` and `+`/`-`/context lines. For New-file mode, call with `before = ''` (all `+` lines). Export a client-side constant `SNIPPET_FILE_PATH = 'snippet.ts'` here that MUST equal the backend `MANUAL_SKILL_CASE_FILE_PATH` (see Risks — kept in sync manually, like the contract mirror).
- `CodeInput.tsx` (`'use client'` inside a client modal): controlled component with props `{ value: string; onChange: (diff: string) => void }`. Renders a New-file / Modified-file toggle; New = one "After" textarea; Modified = "Before" + "After" textareas. On any change, recompute `buildSnippetDiff(...)` and call `onChange(diff)` so the parent stores it as `input_diff`. Include a default-collapsed "Preview generated diff" section showing the produced diff text. All labels via `useTranslations()`. Business logic (diff building) lives in `snippet-diff.ts`, not in the component body.

**Acceptance Criteria:**
- [ ] AC-019: `buildSnippetDiff('', afterText, 'snippet.ts')` yields a diff whose body is entirely `+` lines with a `+++ b/snippet.ts` header.
- [ ] AC-020: `buildSnippetDiff(before, after, 'snippet.ts')` (Modified mode) yields a diff containing both `+` and `-` lines, using `diffLines` from the existing `lcs-diff.ts` (no reimplementation).
- [ ] AC-021: `SNIPPET_FILE_PATH === 'snippet.ts'` (equals backend constant); `CodeInput` emits `input_diff` via `onChange` with no raw-diff syntax required from the user.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-019/020 | `cd client && pnpm test snippet-diff` (unit added in TASK-008) |
| AC-021 | code review + `cd client && pnpm typecheck` |

---

### TASK-007: Frontend case modal + evals tab + skill-type wiring

**Scope:** frontend
**Depends on:** TASK-005 (contract + i18n), TASK-006 (imports `CodeInput`)

**Owned Paths:**
- `client/src/components/evals/EvalCaseModal/EvalCaseModal.tsx`
- `client/src/components/evals/EvalCaseModal/helpers.ts`
- `client/src/components/evals/EvalsTab/EvalsTab.tsx`
- `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx`

**Details — skill-type threading:**
- `SkillEditor.tsx:186` currently `<EvalsTab ownerKind="skill" ownerId={skill.id} />` — pass `skillType={skill.type}` (already in scope). `AgentEditor` path passes no `skillType` (agents have none).
- `EvalsTab` accepts optional `skillType?: SkillType`, forwards it to `<EvalCaseModal skillType=... />`. Derive `usesDiff = skillType !== 'rubric'` (rubric = holistic, no diff).

**Details — `EvalCaseModal.tsx`:**
- Tabs (`EvalCaseModal.tsx:84-86, 454-506`):
  - `skillType === 'rubric'` → render ONLY the `prMeta` tab (Diff/Files/Code **not in DOM**); default `inputTab = 'prMeta'`.
  - skill finding-grounded (`convention`/`security`/`custom`) → replace the raw `diff` tab with the new **Code** tab (`<CodeInput value={diffText} onChange={setDiffText} />`); drop the raw `files` tab for these manual cases (Code covers input).
  - agent-owned → tabs unchanged (existing `diff`/`files`/`prMeta`).
- Skeleton button (`EvalCaseModal.tsx:118-133, 541-548`):
  - `rubric` → "+ Dimension skeleton" inserting `{dimension: '', score: 0, reason: ''}`.
  - skill finding-grounded → "+ Finding skeleton" inserting `{start_line: 0, end_line: 0, severity: '', category: '', title: ''}` — **no `file` key** (server injects `snippet.ts`).
  - agent → existing skeleton (with `file`).
- Expected output panel: halve the textarea height (rows 20 → 10) and add, directly below it in the same right column (below line 556), a **read-only** "Actual output" panel of the same height. Data source: the immediate `useRunEvalCase` result (`runCase.data?.result.per_trace[].actual`, currently unrendered) after "Run case"; on open, seed from the last persisted run's `actual_output` (via the dashboard `recent_runs` the tab already loads, or `EvalRunRecord.actual_output`). Placeholder `t('caseEditor.neverRunYet')` when no run. Updates in place after "Run case" (same mechanism that already refreshes the "Last run passed/failed" badge). No automatic ✓/✗ annotation — visual side-by-side only.

**Details — `EvalCaseModal/helpers.ts`:**
- `tryParseExpectedOutput` / validation must branch by owner: `rubric` → `z.array(RubricAssessment)`; skill finding-grounded → `ExpectedFinding` with `file` optional (skeletons omit it); agent → `ExpectedFinding` with `file` required. The valid/invalid JSON badge then reflects the correct schema.

**Details — `EvalsTab.tsx`:**
- Case-row badge (`EvalsTab.tsx:452-461, 560-573`): for `rubric` skill, render `expected_output[0].dimension` instead of `severity · category` (those fields don't exist on `RubricAssessment`). Use `t('evalsTab.dimension')` label.
- Aggregated tiles (`EvalsTab.tsx:87-361`): for `rubric` skill render only 2 metric tiles (Recall, Precision) — omit the Citation Accuracy tile entirely (not an "N/A" stub). Finding-grounded skills and agents keep the existing tiles.

**Acceptance Criteria:**
- [ ] AC-022: For a `rubric` skill, `EvalCaseModal` renders only the PR-meta tab (Diff/Files/Code absent from DOM); skeleton button reads "+ Dimension skeleton" and inserts `{dimension,score,reason}`; JSON validator validates `RubricAssessment[]`.
- [ ] AC-023: For a finding-grounded skill, the modal shows the **Code** tab (New/Modified toggle) instead of raw Diff; skeleton inserts a finding object with **no `file`** key; validator accepts findings without `file`.
- [ ] AC-024: Agent-owned cases are visually/behaviourally unchanged (Diff/Files/PR-meta tabs, file-bearing skeleton, `ExpectedFinding` with required file).
- [ ] AC-025: "Expected output" height halved; a read-only "Actual output" panel of equal height sits below it, showing the last run's `actual_output` (or "Never run yet"), refreshing in place after "Run case" without reload.
- [ ] AC-026: `EvalsTab` shows the dimension-name badge and only 2 metric tiles for a `rubric` skill; 3 tiles for finding-grounded skills/agents.
- [ ] AC-027: `skill.type` flows `SkillEditor → EvalsTab → EvalCaseModal`; `cd client && pnpm typecheck` passes.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-022/023/024/025/026 | component tests (TASK-008) + manual browser check |
| AC-027 | `cd client && pnpm typecheck` |

---

### TASK-008: Frontend tests

**Scope:** frontend
**Depends on:** TASK-006, TASK-007

**Owned Paths:**
- `client/src/components/evals/EvalCaseModal/snippet-diff.test.ts` (new)
- `client/src/components/evals/EvalCaseModal/EvalCaseModal.test.tsx` (new or extend if present)

**Details:**
- `snippet-diff.test.ts`: New-file mode = all `+` lines; Modified mode = both `+`/`-`; header uses `snippet.ts`.
- `EvalCaseModal.test.tsx`: rubric → only PR-meta tab present, dimension skeleton, rubric JSON validation; finding-grounded skill → Code tab present, no-file skeleton; Actual-output panel placeholder vs populated after a mocked run.

**Acceptance Criteria:**
- [ ] AC-028: `snippet-diff` unit tests pass (jsdom/vitest).
- [ ] AC-029: `EvalCaseModal` tests assert tab visibility per owner type, skeleton shape, and Actual-output rendering.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-028/029 | `cd client && pnpm test` → pass |

---

## Implementation Phases

### Phase 1: DB / Schema
- [ ] None. No migration — reuses `skills.type`, `eval_cases`, `eval_runs` as-is.

### Phase 2: Backend
- [ ] `vendor/shared/contracts/eval-ci.ts` — add `RubricAssessment` (TASK-001)
- [ ] `modules/evals/constants.ts` — add `MANUAL_SKILL_CASE_FILE_PATH` (TASK-001)
- [ ] `modules/evals/scoring.ts` — `isRubricMatch`, `scoreRubricCase`, widen `caseTypeOf` (TASK-002)
- [ ] `modules/evals/helpers.ts` — `parseExpectedOutput(raw, skillType)` + file injection + thread `skillType` through `computeAlert`/`buildDashboard`/DTO mappers (TASK-002)
- [ ] `modules/evals/skill-eval-strategies.ts` — registry + `findingGroundedStrategy` + `rubricStrategy` (TASK-003)
- [ ] `modules/evals/service.ts` — single strategy branch point; preserve `wrapSkillBodyIfUntrusted` for both strategies (TASK-003)
- [ ] `platform/container.ts` — **no change** (no new service/adapter; strategies are pure functions using injected provider/container)

### Phase 3: Frontend
- [ ] `vendor/shared/contracts/eval-ci.ts` — mirror `RubricAssessment` (TASK-005)
- [ ] `messages/en/eval.json` — new i18n keys (TASK-005)
- [ ] `components/evals/EvalCaseModal/snippet-diff.ts` + `CodeInput.tsx` — Code tab (TASK-006)
- [ ] `components/evals/EvalCaseModal/{EvalCaseModal.tsx,helpers.ts}` — tabs, skeletons, validation branch, Actual-output panel (TASK-007)
- [ ] `components/evals/EvalsTab/EvalsTab.tsx` — dimension badge, 2-tile rubric layout, forward `skillType` (TASK-007)
- [ ] `app/skills/[id]/_components/SkillEditor/SkillEditor.tsx` — pass `skill.type` (TASK-007)
- [ ] `lib/api.ts` / `lib/hooks/evals.ts` — **no change expected** (Run case already returns `EvalRunResult` with `per_trace[].actual`; only rendering was missing). Confirm during implementation.

### Phase 4: Tests
- [ ] `modules/evals/scoring.test.ts` — `scoreRubricCase` + regression (TASK-004)
- [ ] `modules/evals/evals.it.test.ts` — rubric 1-call integration (TASK-004)
- [ ] `EvalCaseModal/snippet-diff.test.ts` + `EvalCaseModal.test.tsx` (TASK-008)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `wrapSkillBodyIfUntrusted` is a private `EvalsService` method — extracting the strategy could drop the untrusted-source wrapping (security regression). | Pass the already-wrapped body into `ctx.wrappedBody`; keep the private method as the single wrapping point; existing `evals.it.test.ts` security test must stay green (AC-012). |
| `MANUAL_SKILL_CASE_FILE_PATH` (server) and `SNIPPET_FILE_PATH` (client) must stay equal, or `expected.file === actual.file` matching silently breaks. | Both literally `'snippet.ts'`; document the coupling next to each; assert equality in a comment + covered indirectly by the manual browser check. Same manual-mirror discipline already used for the contract files. |
| `parseExpectedOutput` return type widens to a union — call sites may mis-handle. | Every caller now passes `skillType`; TypeScript exhaustiveness + `pnpm typecheck` catches mismatches (AC-003, AC-008). |
| `rubricStrategy` is the first direct `provider.completeStructured` caller in evals — model/provider must be the resolved feature-model provider, not a fresh instance. | Reuse the `resolveFeatureModelStrict(...,'eval')` result already resolved in `runSkillEvals`; pass `provider`/`model` into `ctx`. No `new` provider anywhere (onion DI rule). |
| `computeAlert`/dashboard for rubric skills call `parseExpectedOutput` without a type and would still collapse to `[]`. | Thread `skillType` (from `owner_id → skills.type`) through `computeAlert`/`buildDashboard`/DTO mappers for skill-owned rows (TASK-002). |
| Client mirror drift already exists (`ConformanceInput` missing `'openrouter'`). | Out of scope for this plan; only add `RubricAssessment` mirror. Note left for a separate cleanup. |

## Out of Scope

- No DB migration; no new columns or enums.
- No auto-generate-case-from-finding button for skills (`prefillFromFinding` stays agent-only by design).
- No change to the agent-owned eval path (tabs, skeleton, scoring all unchanged).
- No automatic ✓/✗ diff annotation between Expected and Actual (visual side-by-side only).
- Fixing the pre-existing client `ConformanceInput` `'openrouter'` mirror drift.
- Seeding `eval_cases` (the root-level `pr-quality-rubric-cases.ts` is an untracked scratch file; converting/seeding it is not part of this fix).

## Architecture Notes

- **Onion / DI:** strategies are pure functions parameterised by an injected `provider` (`LLMProvider` port, `adapters.ts:82-86`) and `container`; no `new` adapter instantiation, so `platform/container.ts` is untouched. Scoring/parsing stay pure (no I/O). Repository writes remain the only DB touch.
- **Discriminator:** the existing `skills.type` enum (`skills.ts:25-27`, contract `knowledge.ts:183`) is the single source of branching — no new column. `eval_cases.owner_kind` still distinguishes skill vs agent; skill `type` is resolved via `container.skillsRepo.getById`.
- **Deviation from design doc caught in survey:** `computeAlert` lives in `helpers.ts:135`, not `scoring.ts` — it is a `parseExpectedOutput` caller and must receive `skillType`. Encoded in TASK-002.
- **Actual-output data already persisted:** `eval_runs.actual_output` and the live `EvalRunResult.result.per_trace[].actual` already exist; the client simply never rendered them. The panel is pure display wiring — no API/hook change expected.
- **Registry is the extension point:** a future 5th skill type with yet another output contract is added by registering one more `SkillEvalStrategy`, not by hunting `if`s across execute/score/UI.
