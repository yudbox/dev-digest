# Plan: Multi-Agent Review

> Status: DRAFT
> Created: 2026-07-12
> Spec: specs/SPEC-2026-07-12-multi-agent-review.md
> Execution Mode: multi-agent (backend track ∥ frontend track, after a shared backend foundation task)

## Requirements (VRF)
> Status: Confirmed by user — all three Q1-Q3 defaults accepted as-is (Jaccard threshold 0.3,
> default page size 20, reuse lucide-react via existing `client/src/vendor/ui/icons.tsx` central
> icon file with a small keyword→icon map). No spec edits. Execution mode chosen by planner per
> user's delegation ("pick execution mode yourself").

65 ACs restated as R1-R65 — full table below.

| ID | Requirement | Source |
|----|------------|--------|
| R1 | Replace RunReviewDropdown's single/all-agent selector with a "PICK AGENTS TO RUN" checkbox panel — one checkbox per agent of active repo (from GET /agents), each with a time estimate | AC-1 |
| R2 | While 0..N-1 agents checked, control shows "Select All"; click checks all | AC-2 |
| R3 | While all N agents checked, control shows "Clear All"; click unchecks all | AC-3 |
| R4 | If PR merged (warnMerged), show "Already merged — review is informational" banner atop panel; run stays enabled | AC-4 |
| R5 | If no agent checked, run button disabled, no "(N)" | AC-5 |
| R6 | Exactly 1 agent checked -> button reads "Run {AgentName}" | AC-6 |
| R7 | 2+ agents checked -> button reads "Run multi-agent review (N)" | AC-7 |
| R8 | PR-picker run with exactly 1 agent -> existing POST /pulls/:id/review {agentId}, stay on PR page, result in existing Agent runs timeline, NO multi_agent_runs row | AC-8 |
| R9 | PR-picker run with 2+ agents -> new POST /pulls/:id/multi-agent-run, creates multi_agent_runs row, redirect to /multi-agent-review/[runId] | AC-9 |
| R10 | Picker panel shows "Configure agents..." link to existing /agents page (unchanged) | AC-62 |
| R11 | /multi-agent-review/new before PR chosen: render only PR picker scoped to active repo/workspace + placeholder text | AC-10 |
| R12 | Once PR chosen: show agent tiles for that PR's repo, all checked by default | AC-11 |
| R13 | Each tile: checkbox, client-derived type icon (keyword->icon map from name/description), name, description, corner badge with avg_duration_ms/avg_cost_usd | AC-12 |
| R14 | Toggling checkboxes live-recalculates summary line (time/cost/parallel fan-out) | AC-13 |
| R15 | Agent tile list has same Select All/Clear All control as PR picker | AC-64 |
| R16 | No PR OR no agent checked -> Run button disabled, no "(N)"; else enabled with "(N)" | AC-14 |
| R17 | Configure-run submit with N>=1 ALWAYS calls POST /pulls/:id/multi-agent-run and ALWAYS creates multi_agent_runs row (even N=1); redirect to detail page | AC-15 |
| R18 | Detail page header: breadcrumb "Multi-Agent Review > #{pr_number}", "Configure run" button, title + "N selected agents - parallel", Columns/Tabs switch, pr_title row, stat line | AC-16 |
| R19 | "Configure run" click -> /multi-agent-review/new prefilled with same PR (agents defaulted checked), creates a new independent multi_agent_runs row | AC-65 |
| R20 | [runId] = multi_agent_runs.id (UUID); "#{pr_number}" is display-only via join, not a route param | AC-17 |
| R21 | Stat line: agent_count = # selected; total_duration_ms = max(duration_ms); total_cost_usd = sum(cost_usd) | AC-18 |
| R22 | While running, stats/columns live-update via existing SSE useRunEvents(runIds:string[]); after done show final persisted values | AC-19 |
| R23 | Tabs mode: one tab/agent (name+score badge); body = VerdictBanner + FindingsPanel(FindingCard list); most-severe expanded by default | AC-20 |
| R24 | Columns mode: compact live card/agent side-by-side (border pulses per verdict); header shows progress% + elapsed time + cost while running; final score/time/cost after done | AC-21 |
| R25 | Click compact finding row in Columns card -> switch to Tabs, select that agent tab, auto-expand+scroll to finding, reuse FindingCard targeted/focused props | AC-22 |
| R26 | Extend VerdictBanner with optional time/cost/"View trace" props (extension not fork) | AC-23 |
| R27 | Columns "N%" computed client-side: min(95%, elapsed_ms/avg_historical_duration_ms_of_agent*100); no new backend progress mechanism; jumps to final on done/failed | AC-63 |
| R28 | "View trace" in column/tab reuses existing RunTraceDrawer+LiveLogStream unchanged, passing runId(+agentName,prNumber) | AC-24 |
| R29 | Multi-agent execution in run-executor.ts runs concurrently (Promise.allSettled over existing runOneAgent) so total_duration_ms ~= max not sum | AC-25 |
| R30 | Preserve current isolation model (try/catch per agent, same process, shared read-only diff/intent); no worktree/process isolation | AC-26 |
| R31 | Both view modes show "WHERE AGENTS DISAGREE" section — one row per contention group (file:line), one mini-column per EVERY selected agent (not just flaggers) | AC-27 |
| R32 | Same-location detection = one pure swappable function (new file) in reviews module, importing rangesOverlap from reviewer-core + lightweight Jaccard/token-overlap on titles, no LLM/embeddings | AC-28 |
| R33 | Agent flagged contention location -> mini-tile shows severity badge (CRITICAL/WARNING/SUGGESTION palette) + note=finding.title; click triggers Columns->Tabs handoff | AC-29 |
| R34 | Agent did not flag contention location -> mini-tile shows neutral muted "did not flag", no reason text, not clickable | AC-30 |
| R35 | "Show only conflicts" OFF (default): show every contention location per literal Conflict contract (>=1 flagged AND >=1 other ran-but-silent, OR divergent severity) incl. "1 flagged, rest silent" | AC-31 |
| R36 | "Show only conflicts" ON: narrow to true head-to-head (2+ agents each with own finding, divergent severity/verdict); hide "1 flagged, rest silent" | AC-32 |
| R37 | Conflicts computed at read-time from persisted findings, not stored in DB | AC-33 |
| R38 | Reuse existing FindingCard as-is per finding row (Accept/Dismiss/Undo/Turn-into-eval-case against existing endpoints); file:line as MonoLink to githubBlobUrl(...) | AC-34 |
| R39 | "Learn" click -> inline composer (textarea prefilled from finding.title, editable); confirm calls findings-action route action="learn" + note | AC-35 |
| R40 | On action=learn, server embeds note via container.embedder(), inserts memory row kind='learning', scope='repo', sources={finding_id,agent_id,pr_id} | AC-36 |
| R41 | "Reply to author" click -> composer (reuse InlineComposer/DiffCommentApi pattern); submit calls existing POST /pulls/:id/comments (GitHub) + findings-action action="reply" sets findings.repliedAt | AC-37 |
| R42 | Add optional note?:string field to FindingAction contract only; Finding/FindingRecord shape untouched | AC-38 |
| R43 | Extend existing findings-action route/actOnFinding to accept "learn" and "reply" action values (no new route) | AC-39 |
| R44 | Before reviewPullRequest, run-executor.ts embeds short query (PR title+changed file paths), pgvector similarity search in memory scoped to workspaceId+(repoId match or scope='global'), top-K~5, maps into prompt memory:string[] + trace memory_pulled, bumps lastUsedAt | AC-40 |
| R45 | Populate RunTrace.memory_pulled with real data (was hardcoded []), no client trace-UI changes | AC-41 |
| R46 | /multi-agent-review lists workspace runs newest-first via GET /multi-agent-runs — includes ALL multi_agent_runs rows (incl. single-agent Configure-run batches) but NOT N=1 PR-picker runs | AC-42 |
| R47 | GET /multi-agent-runs uses keyset/cursor pagination (ran_at,id)<(cursor) ORDER BY ran_at DESC,id DESC LIMIT :limit -> {items, next_cursor} | AC-43 |
| R48 | status param filters by aggregated status: running if any agent_runs running; else failed if any failed; else done | AC-44 |
| R49 | q param filters via simple ILIKE on PR title/number, no new search infra | AC-45 |
| R50 | New lean contract MultiAgentRunSummary: id,pr_id,pr_number,pr_title,agent_count,total_duration_ms,total_cost_usd,ran_at,status — separate from heavy MultiAgentRun | AC-46 |
| R51 | GET /multi-agent-runs/:id keyed by multi_agent_runs.id -> full MultiAgentRun | AC-47 |
| R52 | Extend AgentsRepository.statsForWorkspace with new aggregate avg_duration_ms alongside avg_cost_usd, exposed on existing Agent contract via existing GET /agents — no new endpoint, no duplicate reviews-owned query | AC-48 |
| R53 | Migration #1: nullable FK multiAgentRunId on agentRuns -> multiAgentRuns.id, onDelete:'set null', via pnpm db:generate | AC-49 |
| R54 | Add exactly one nav item "Multi-Agent Review" -> /multi-agent-review in NAV, reuse existing dead activeKeyFor key, new "GLOBAL" group if absent; no Agent Performance/CI Runs/Memory items | AC-50 |
| R55 | Every agent_runs row appears in both PR-page TIMELINE and REVIEW RUNS sections regardless of trigger, both fed by unchanged listRunsForPull — counts must match 1:1 | AC-51 |
| R56 | Migration #2: nullable timestamp repliedAt on findings (mirrors accepted_at/dismissed_at), via pnpm db:generate; additive only | AC-61 |
| R57 | Replace global getLatestReviewData with latest-per-agent query (DISTINCT ON agent_id ORDER BY agent_id, created_at DESC), union findings across latest-per-agent reviews in Smart Diff tab | AC-52 |
| R58 | Reuse existing most-severe-wins-per-line logic (service.ts:40-56) unchanged, widen input to unioned latest-per-agent findings | AC-53 |
| R59 | Dismissed findings not shown as live badges (reuse dismissed_at); accepted findings visible but dimmed | AC-54 |
| R60 | Extend existing MultiAgentRun contract (observability.ts) with pr_title:string alongside pr_number; no other field changes | AC-60 |
| R61 | 3 agents on demo PR -> Where-agents-disagree correctly groups same-location findings (incl. did-not-flag), live column updates during run | AC-55 |
| R62 | 1 agent then 3 agents on same PR -> 3-agent total cost ~3x, wall-clock does not scale ~3x | AC-56 |
| R63 | Accept finding + Learn -> memory row kind='learning' w/ real embedding; same agent reruns on related PR -> trace.memory_pulled non-empty | AC-57 |
| R64 | 6+ agents -> columns row natively horizontally scrollable (overflow-x:auto), fixed min-width ~280-320px/card, no carousel | AC-58 |
| R65 | 5+ findings in agent card -> findings list natively vertically scrollable (overflow-y:auto + max-height ~3-4 rows), thin scrollbar, no width growth | AC-59 |

## Open Questions & Recommendations (resolved)

| # | Question | Answer | Type |
|---|----------|--------|------|
| Q1 | Jaccard/token-overlap similarity threshold for `isSameLocation` (AC-28)? | 0.3 (30% token overlap) | gap |
| Q2 | Default `limit` (page size) for `GET /multi-agent-runs` (AC-43)? | 20 | gap |
| Q3 | Icon set / keyword map for AC-12 agent tile icons? | Reuse `lucide-react` (confirmed present at `client/package.json` `lucide-react@^0.469.0`) via the existing central `client/src/vendor/ui/icons.tsx` re-export file — do not import `lucide-react` ad hoc in new components. | gap |

## Research findings that refine the spec's assumptions (not spec changes — implementation facts)

These were discovered during codebase research and materially change *how* several ACs are
implemented, without changing *what* they require. Flagging them here for traceability since they
affect owned-path/task design below.

1. **`FindingActionKind` already includes `"learn"` and `"reply"`** in the Zod enum at
   `server/src/vendor/shared/contracts/findings.ts:88-95`. AC-39 ("extend findings-action route to
   accept learn/reply") therefore requires **no enum change** — only wiring `actOnFinding()`'s
   `switch` (currently `default: throw AppError("invalid_action")`) and registering the two new
   routes in `routes.ts`. `FindingAction` (same file, lines 97-101) **already has an optional
   `reply?: string` field**, apparently a pre-built stub, currently unused by `actOnFinding()`
   (which today only takes the bare `action` enum value, not the full body). Per AC-38's literal
   instruction ("add one optional field `note?: string`"), TASK-001 adds a **new** `note?: string`
   field alongside the existing unused `reply` field — it does not rename or repurpose `reply`.
2. **`server/docs/api-contracts.md`'s documented `RunEvent` union** (`started | log | progress |
   completed | failed`, with `progress` already carrying a numeric `percent` field) does not match
   the spec's claim that existing SSE events are `info | tool | result | error` with no numeric %.
   Since SSE/`RunBus`/`useRunEvents` are explicitly out of scope and unchanged for this feature
   either way, this doesn't block anything — but TASK-005 (client-side AC-63 progress calc) must
   verify the *actual* emitted event shape in `server/src/modules/reviews/run-executor.ts` +
   `platform/sse.ts` rather than trust either doc, since one of the two is stale.
3. **`client/CLAUDE.md` says `useRunEvents` lives at `src/lib/hooks/useRunEvents.ts`; it actually
   lives at `client/src/lib/hooks/reviews.ts:164`**, already typed `useRunEvents(runIds: string[])`
   exactly as the spec assumes. Use the real path.
4. **AC-34 says "reuse `FindingCard` as-is," but AC-35/AC-37 require Learn/Reply buttons that don't
   exist in `FindingCard`'s current rendered UI** (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
   currently only renders Accept/Undo/Dismiss buttons, even though its `onAction` prop is already
   typed to accept the full `FindingActionKind` including `learn`/`reply`). This is treated the same
   way the spec explicitly authorizes for `VerdictBanner` (AC-23: "extend, don't fork") — TASK-005
   extends `FindingCard`'s button row + adds the inline composer, it does not fork a new component.
   This file is not explicitly named in the spec's "Module boundaries" list (which only names
   `client/src/app/multi-agent-review/**` and the PR-page picker component) but is a necessary,
   narrow, additive UI extension required to satisfy AC-35/AC-37 — flagged here for visibility, not
   proposed as new scope.
5. Root `CLAUDE.md` calls the migrations directory `drizzle/`; the verified real path is
   `server/src/db/migrations/*.sql` (19 files today, `0000_init.sql` → `0018_special_sphinx.sql`,
   Drizzle Kit auto-naming). Use the real path in all migration-related task steps.
6. `getLatestReviewData` (AC-52) does **not** live in `server/src/modules/pulls/service.ts` — it
   lives in `server/src/modules/reviews/repository/review.repo.ts:179-224`, proxied through
   `ReviewRepository.getLatestReviewData()`. `pulls/service.ts`'s `buildSmartDiff()` only
   *consumes* it. So the query-shape change (single-latest → latest-per-agent `DISTINCT ON`) is
   reviews-module work (TASK-002); the narrow `pulls` boundary exception (TASK-003) is strictly the
   `buildSmartDiff()` consumer-side update to union across the new array shape.

## Affected Modules

| Module | Path | Change Type |
|--------|------|-------------|
| backend: db schema | `server/src/db/schema/runs.ts`, `server/src/db/schema/reviews.ts` | Modify (additive nullable columns) |
| backend: shared contracts | `server/src/vendor/shared/contracts/observability.ts`, `findings.ts`, `knowledge.ts` | Modify |
| backend: `agents` (exception #5) | `server/src/modules/agents/repository.ts` | Modify |
| backend: `reviews` | `server/src/modules/reviews/**` | Add / Modify |
| backend: `pulls` (exception #3) | `server/src/modules/pulls/service.ts` | Modify |
| frontend: PR-page picker | `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**` | Modify |
| frontend: shared agent-picker control | `client/src/components/agent-picker/**` | Add |
| frontend: data layer | `client/src/lib/hooks/reviews.ts` | Modify |
| frontend: nav | `client/src/vendor/ui/nav.ts` | Modify |
| frontend: `multi-agent-review` pages | `client/src/app/multi-agent-review/**` | Add |
| frontend: FindingCard/VerdictBanner extensions | `.../pulls/[number]/_components/FindingCard/**`, `.../VerdictBanner/**` | Modify |
| frontend: icons | `client/src/vendor/ui/icons.tsx` | Modify |

## Tasks

### TASK-001: DB migrations + shared contracts + agents `avg_duration_ms` exception

**Scope:** backend

**Owned Paths:**
- `server/src/db/schema/runs.ts` (add nullable `multiAgentRunId` FK on `agentRuns`)
- `server/src/db/schema/reviews.ts` (add nullable `repliedAt` timestamptz on `findings`)
- `server/src/db/migrations/` (new generated migration file(s) via `pnpm db:generate` — never hand-edit existing ones)
- `server/src/vendor/shared/contracts/observability.ts` (add `pr_title` to `MultiAgentRun`; add new `MultiAgentRunSummary` contract — do NOT touch `AgentStats`/`AgentColumn`/`Conflict`/`ConflictTake`, those are target-as-is)
- `server/src/vendor/shared/contracts/findings.ts` (add `note?: string` to `FindingAction`; `FindingActionKind` needs no change — already has `learn`/`reply`; do not touch `Finding`/`FindingRecord` shape)
- `server/src/vendor/shared/contracts/knowledge.ts` (add `avg_duration_ms: z.number().nullish()` to `Agent` contract, alongside existing `avg_cost_usd` at line ~288)
- `server/src/modules/agents/repository.ts` (extend `statsForWorkspace`, lines 332-387: internal `AgentStats` interface + `runsAgg` subquery `avg(agentRuns.durationMs)` + `Map` threading, mirroring how `avgCost` is threaded today)
- Wherever the `Agent` DTO is assembled from `statsForWorkspace`'s map for the `GET /agents` response (implementer: grep `statsForWorkspace(` callers in `server/src/modules/agents/` to find the exact assembly site — not confirmed by research, verify before editing)

**Acceptance Criteria:**
- [ ] AC-49: `agentRuns` has a new nullable `multiAgentRunId` column, FK → `multiAgentRuns.id`, `onDelete: 'set null'`, generated via `pnpm db:generate` (not hand-written)
- [ ] AC-61: `findings` has a new nullable `repliedAt` timestamptz column mirroring `acceptedAt`/`dismissedAt`; existing `Finding`/`FindingRecord` fields unchanged
- [ ] AC-60: `MultiAgentRun` contract has `pr_title: string` alongside existing `pr_number`; no other field changes
- [ ] AC-46: New `MultiAgentRunSummary` contract exists with exactly `id, pr_id, pr_number, pr_title, agent_count, total_duration_ms, total_cost_usd, ran_at, status`, separate from `MultiAgentRun`
- [ ] AC-38: `FindingAction` has new optional `note?: string`; `Finding`/`FindingRecord` untouched; pre-existing unused `reply?: string` field left as-is (not renamed/removed)
- [ ] AC-48: `Agent` contract has new `avg_duration_ms` field alongside `avg_cost_usd`; `statsForWorkspace` is the single source computing both (no duplicate query elsewhere)

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-49 | `cd server && pnpm db:generate` produces exactly one new migration file; `pnpm db:migrate` succeeds; inspect generated SQL for nullable FK + `ON DELETE SET NULL` |
| AC-61 | Same migration batch (or separate, per spec "migration #2") adds nullable `replied_at`; `psql \d findings` (or Drizzle introspection) shows column, existing columns unchanged |
| AC-60 / AC-46 | `cd server && pnpm typecheck` passes; `pnpm exec vitest run --exclude '**/*.it.test.ts'` (any contract-adjacent existing tests still pass, since this is additive) |
| AC-38 | `pnpm typecheck` passes with `note` in `FindingAction`; grep confirms `Finding`/`FindingRecord` diff is empty |
| AC-48 | `cd server && pnpm exec vitest run agents` (existing `statsForWorkspace` tests, if any, still pass) — full end-to-end `GET /agents` verification happens in TASK-002's integration tests once routes exist |

---

### TASK-002: Reviews module core — multi-agent service/repository/routes, conflict detection, concurrent fan-out, memory retrieval, Learn/Reply

**Scope:** backend

**Depends on:** TASK-001 (contracts + migrations)

**Owned Paths:**
- `server/src/modules/reviews/routes.ts` (add `POST /pulls/:id/multi-agent-run`, `GET /pulls/:id/multi-agent`, `GET /multi-agent-runs`, `GET /multi-agent-runs/:id`; extend `FINDING_ACTIONS`/route registration to add `POST /findings/:id/learn`, `POST /findings/:id/reply`)
- `server/src/modules/reviews/service.ts` (new orchestration methods for multi-agent run create/list/get; update `actOnFinding` call site to pass through `note`)
- `server/src/modules/reviews/repository.ts` (facade — add delegation to new multi-agent repo functions)
- `server/src/modules/reviews/repository/multi-agent.repo.ts` (**new file** — pure functions: create `multi_agent_runs` row + link `agent_runs.multiAgentRunId`, get-by-id, keyset-paginated list with `status`/`q` filters, following the existing `pull.repo.ts`/`review.repo.ts`/`run.repo.ts` pattern)
- `server/src/modules/reviews/repository/review.repo.ts` (modify `getLatestReviewData`, lines 179-224 → `DISTINCT ON (agent_id) ... ORDER BY agent_id, created_at DESC`, returning an array instead of a single row)
- `server/src/modules/reviews/repository/memory.repo.ts` (**new file** — pure functions for pgvector similarity search + `lastUsedAt` bump + insert, importing the `memory` table directly from `server/src/db/schema/knowledge.ts` per module-boundary exception #1; schema file itself is NOT edited)
- `server/src/modules/reviews/conflict-detection.ts` (**new file** — `isSameLocation()` importing `rangesOverlap` from `@devdigest/reviewer-core` + Jaccard token-overlap on finding titles at threshold **0.3**; plus the grouping/conflict-computation function consumed by the detail route; pure, swappable, read-time only, no DB writes)
- `server/src/modules/reviews/run-executor.ts` (convert the sequential `for` loop in `executeRuns()`, lines 186-233, to `Promise.allSettled` over `runOneAgent`; add memory-retrieval step before the `reviewPullRequest` call at line 384, using `container.embedder()` + `memory.repo.ts`; replace hardcoded `memory_pulled: []` at lines 489 and 675 with real data; preserve try/catch-per-agent isolation, same-process execution — no worktree/child-process changes)
- `server/src/modules/reviews/findings.ts` (extend `actOnFinding()` switch to handle `"learn"` — embed `note` via `container.embedder()`, insert into `memory` via `memory.repo.ts` with `kind='learning'`, `scope='repo'`, `sources={finding_id,agent_id,pr_id}` — and `"reply"` — set `findings.repliedAt`; update function signature to accept the note/full action body, not just the bare enum)
- `server/src/platform/container.ts` (only if a new top-level repo class is introduced beyond what's already reachable via `container.reviewRepo`/`container.embedder()` — verify during implementation; prefer extending the existing `ReviewRepository` facade over adding new container properties)

**Acceptance Criteria:**
- [ ] AC-9: 2+ agents via PR-picker → `POST /pulls/:id/multi-agent-run` creates a `multi_agent_runs` row + linked `agent_runs`, redirects client to `/multi-agent-review/[runId]`
- [ ] AC-15: Configure-run submit with N≥1 (including N=1) always calls `POST /pulls/:id/multi-agent-run` and always creates a `multi_agent_runs` row
- [ ] AC-17: `GET /multi-agent-runs/:id` keyed by `multi_agent_runs.id` (UUID)
- [ ] AC-18: Stat computation — `agent_count` = selected count, `total_duration_ms` = max, `total_cost_usd` = sum
- [ ] AC-25 / AC-56: `executeRuns()` runs agents concurrently via `Promise.allSettled`; `total_duration_ms ≈ max(duration_ms)`, not sum; `total_cost_usd = sum(cost_usd)`
- [ ] AC-26: Isolation model preserved — try/catch per agent, same process, one agent failing doesn't abort others
- [ ] AC-27 / AC-31 / AC-32: "Where agents disagree" data — every selected agent represented per contention group; toggle semantics (all contentions vs. true head-to-head) implemented in `conflict-detection.ts`, consumed at read-time by the detail route
- [ ] AC-28: `isSameLocation()` — unit-testable pure function, `rangesOverlap` (reviewer-core) + Jaccard ≥ 0.3 on titles, no LLM/embeddings
- [ ] AC-33: Conflicts computed at read-time from persisted findings, never written to DB
- [ ] AC-36: `action=learn` → `memory` row inserted with `kind='learning'`, `scope='repo'`, real embedding, `sources={finding_id,agent_id,pr_id}`
- [ ] AC-37 (server half) / AC-61: `action=reply` → `findings.repliedAt` set and persists across reload
- [ ] AC-39: `actOnFinding`/routes accept `"learn"` and `"reply"` without `invalid_action`
- [ ] AC-40 / AC-57: Before `reviewPullRequest`, embeds PR title + changed file paths, pgvector search scoped to `workspaceId` + (`repoId` match or `scope='global'`), top-K≈5, `lastUsedAt` bumped on used rows, results flow into both the prompt `memory: string[]` and `trace.memory_pulled`
- [ ] AC-41: `RunTrace.memory_pulled` populated with real data (no client trace-UI changes)
- [ ] AC-42 / AC-43 / AC-44 / AC-45: `GET /multi-agent-runs` — newest-first, keyset pagination (`limit` default **20**), `status` aggregation (running > failed > done precedence), `q` via parameterized `ILIKE` on PR title/number
- [ ] AC-47: `GET /multi-agent-runs/:id` returns full `MultiAgentRun` incl. `pr_title`, `columns`, `conflicts`
- [ ] AC-51 (verification-only, no code change expected): confirm `agent_runs` created via the multi-agent path still surface in the existing `listRunsForPull`-fed Timeline/Review-Runs sections unmodified

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-25/AC-56 | `cd server && pnpm exec vitest run reviews/run-executor` (extend existing `run-executor.test.ts`) — assert `Promise.allSettled` call and that mocked-delay agents produce `total_duration_ms < sum` |
| AC-28 | `cd server && pnpm exec vitest run reviews/conflict-detection` — truth table: overlap+similar titles → true; overlap+unrelated titles → false; threshold boundary at 0.3 |
| AC-36/AC-40/AC-57 | `cd server && pnpm exec vitest run .it.test` (real Postgres) — learn → memory row w/ non-null embedding; rerun same agent → `trace.memory_pulled` non-empty |
| AC-42-45 | `.it.test.ts` — insert 3+ runs, page through with cursor, assert no dup/skip on insert-between-pages; `status=running` returns only active; `q` narrows by ILIKE |
| AC-9/AC-15/AC-51 | `.it.test.ts` — N=2 PR-picker path creates exactly 1 `multi_agent_runs` row; N=1 Configure-run path also creates exactly 1; both paths' `agent_runs` rows appear via unchanged `listRunsForPull` |
| AC-33 | `.it.test.ts` — assert no `conflicts` table/column write; two sequential `GET` calls after an accept/dismiss return recomputed (different) conflict sets |

---

### TASK-003: Smart Diff latest-per-agent fix (narrow `pulls` boundary exception)

**Scope:** backend

**Depends on:** TASK-002 (needs `getLatestReviewData`'s new array-returning shape)

**Owned Paths:**
- `server/src/modules/pulls/service.ts` (`buildSmartDiff()` only — consume the new latest-per-agent array from `getLatestReviewData`, union findings, reuse existing most-severe-wins-per-line logic unchanged at lines 40-56, respect `dismissedAt`/`acceptedAt` filtering)

**Acceptance Criteria:**
- [ ] AC-52: Files-changed/Smart Diff tab shows a union of latest-per-agent findings (e.g. 3×General + 1×Security + 1×TestQuality → union = Security + TestQuality + only-newest-General)
- [ ] AC-53: Most-severe-wins-per-line logic (`service.ts:40-56`) reused unchanged, only its input widened
- [ ] AC-54: Dismissed findings excluded from live badges; accepted findings shown dimmed, not hidden

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-52 | `cd server && pnpm exec vitest run .it.test` — seed 3×General+1×Security+1×TestQuality runs on one PR, assert Smart Diff response matches expected union |
| AC-53 | Same test — seed conflicting severities on one line across agents, assert most-severe wins |
| AC-54 | Same test — dismiss one finding, assert absent from badges; accept one, assert present with dimmed flag |

---

### TASK-004: Frontend data layer + PR-page agent picker + shared Select-All control + nav item

**Scope:** frontend

**Depends on:** TASK-001 (contract types); can start once TASK-001 lands, does not need TASK-002/003 to be functionally complete to typecheck (routes will 404 at runtime until TASK-002 lands, acceptable for parallel development — final integration verification happens after both tracks converge)

**Owned Paths:**
- `client/src/lib/hooks/reviews.ts` (add `useMultiAgentRun` mutation for `POST /pulls/:id/multi-agent-run`; add `useMultiAgentRuns` list query and `useMultiAgentRun(id)` / `usePrMultiAgentRun(prId)` detail queries; extend the existing finding-action mutation to pass `note` through for `learn`, and confirm/expose a `reply`-composer-triggering path that also calls existing `POST /pulls/:id/comments`)
- `client/src/components/agent-picker/` (**new folder** — `SelectAllClearAllControl.tsx`, the single reusable Select All/Clear All control shared by the PR-page picker (AC-2/AC-3) and Configure-run agent tiles (AC-64))
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/` (rework into the "PICK AGENTS TO RUN" checkbox panel — AC-1, AC-4-8, AC-62; N=1/N≥2 branching logic AC-8/AC-9 client-side dispatch)
- `client/src/vendor/ui/nav.ts` (add new `"GLOBAL"` `NavGroup` if absent, add exactly one `NavItemDef` with `key: "multi-agent"` → `/multi-agent-review`, reusing the existing dead branch in `client/src/components/app-shell/helpers.ts:28` — that helpers.ts file itself is NOT edited, only `nav.ts`; reuse an existing icon already exported from `client/src/vendor/ui/icons.tsx`, do not add a new icon here)

**Acceptance Criteria:**
- [ ] AC-1: "PICK AGENTS TO RUN" panel replaces prior single/all-agent selector, one checkbox per repo agent + time estimate
- [ ] AC-2 / AC-3: Select All ↔ Clear All semantics via the new shared control
- [ ] AC-4: Merged-PR banner shown, run stays enabled
- [ ] AC-5 / AC-6 / AC-7: Button disabled/labelled state machine (0 / 1 / 2+ selected)
- [ ] AC-8: N=1 → existing `POST /pulls/:id/review {agentId}`, stay on page, no `multi_agent_runs` row
- [ ] AC-9 (client half): N≥2 → new mutation, redirect to `/multi-agent-review/[runId]`
- [ ] AC-62: "Configure agents..." link → `/agents` (unchanged page)
- [ ] AC-50: Exactly one new nav item, correct active-state highlighting on `/multi-agent-review`

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-1/AC-5/AC-6/AC-7 | `cd client && pnpm test RunReviewDropdown` (component test — count checkboxes = agent count; button label/disabled states per selection count) |
| AC-2/AC-3 | `cd client && pnpm test SelectAllClearAllControl` (unit/component test — toggle semantics) |
| AC-8/AC-9 | `./scripts/e2e.sh` (or targeted e2e flow) — N=1 stays on PR page, no redirect; N=2 redirects to `/multi-agent-review/<uuid>` |
| AC-50 | `cd client && pnpm test nav` (if nav has existing tests) or e2e — exactly one new item present, active state matches path |

---

### TASK-005: `/multi-agent-review` pages (list, Configure run, detail) + FindingCard/VerdictBanner extensions

**Scope:** frontend

**Depends on:** TASK-004 (hooks + shared Select-All control must exist first)

**Owned Paths:**
- `client/src/app/multi-agent-review/page.tsx` (list — AC-42/50 nav target)
- `client/src/app/multi-agent-review/new/page.tsx` (Configure run — AC-10-15, AC-64)
- `client/src/app/multi-agent-review/[runId]/page.tsx` (detail — AC-16-24, AC-63, AC-65)
- `client/src/app/multi-agent-review/**/_components/**` (Columns view, Tabs view, `WhereAgentsDisagree` section + `ConflictRow`/`ConflictTile`, `AgentColumnCard`, agent-tile keyword→icon map constants file, list-page filter/search UI, pagination "load more" via `next_cursor`)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` (extend button row: add Learn button → inline composer prefilled from `title`; add Reply button → composer reusing `InlineComposer`/`DiffCommentApi` pattern; wire both through existing `onAction` prop, already typed for `learn`/`reply`)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/VerdictBanner.tsx` (extend with optional `time`/`cost`/`onViewTrace` props — additive, existing callers unaffected)
- `client/src/vendor/ui/icons.tsx` (add the small set of icons needed for the AC-12 keyword→icon map, e.g. security→Shield, performance→Zap, test→FlaskConical, style/lint→Paintbrush, fallback→Bot — re-exported from `lucide-react` per this file's existing central pattern)

**Acceptance Criteria:**
- [ ] AC-10 / AC-11 / AC-12 / AC-13 / AC-14 / AC-64: Configure-run two-step gating, agent tiles w/ icon+estimate, live-recalculating summary, Select-All reuse, button disabled/count state
- [ ] AC-16 / AC-17 / AC-65: Detail page header, breadcrumb, "Configure run" round-trip creating a new independent run
- [ ] AC-19: Live stat/column updates via `useRunEvents(runIds)` while running, final values after done
- [ ] AC-20 / AC-22: Tabs mode — one tab/agent, `VerdictBanner`+`FindingsPanel`, most-severe expanded by default; Columns→Tabs handoff on finding-row click
- [ ] AC-21 / AC-63: Columns mode — live cards, client-side progress % formula `min(95%, elapsed_ms/avg_historical_duration_ms×100)`, final numbers on done/failed
- [ ] AC-23: `VerdictBanner` renders time/cost/"View trace" only when props passed; unchanged otherwise
- [ ] AC-24: "View trace" reuses `RunTraceDrawer`+`LiveLogStream` unmodified, correct `runId`/`agentName`/`prNumber`
- [ ] AC-27 / AC-29 / AC-30 / AC-31 / AC-32: "WHERE AGENTS DISAGREE" section rendering — per-agent mini-columns, severity badge+title for flaggers, muted "did not flag" (non-clickable) for non-flaggers, toggle behavior
- [ ] AC-34: `FindingCard` reuse for Accept/Dismiss/Undo/eval-case, `file:line` as `MonoLink`→`githubBlobUrl`
- [ ] AC-35 / AC-37 (client half): Learn composer (prefilled, editable) and Reply composer, wired to `onAction`
- [ ] AC-42 (client half): List page shows all `multi_agent_runs`, newest-first
- [ ] AC-58 / AC-59: 6+ agents → horizontal scroll columns row, no carousel; 5+ findings → vertical scroll within card, no width growth

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-12 | `cd client && pnpm test` — unit test for the keyword→icon map function |
| AC-20/AC-22 | `cd client && pnpm test` (component tests for Tabs view + handoff) or `./scripts/e2e.sh` |
| AC-63 | `cd client && pnpm test` — unit test for the progress-% pure function given known elapsed/avg inputs |
| AC-27/AC-31/AC-32 | `./scripts/e2e.sh` — toggle "Show only conflicts", assert row visibility changes per AC-31/32 |
| AC-58/AC-59 | `./scripts/e2e.sh` — 6-agent and 5-finding fixture PRs, assert `overflow-x`/`overflow-y` scroll containers present, no carousel controls |
| AC-35/AC-37 | `./scripts/e2e.sh` — Learn → composer → submit → network assertion `action=learn`+`note`; Reply → composer → submit → `POST /pulls/:id/comments` called |

---

## Implementation Phases

> ⚙️ Execution mode: **multi-agent** — TASK-001 runs first and alone (both tracks depend on its
> contracts/migrations), then **Backend track (TASK-002 → TASK-003) ∥ Frontend track
> (TASK-004 → TASK-005)** run as two parallel implementers.

### Phase 1: Foundation (sequential, blocking)
- [ ] TASK-001 — DB schema, migrations, shared contracts, `agents` `avg_duration_ms` exception
- [ ] `cd server && pnpm db:generate` then `pnpm db:migrate`
- [ ] `cd server && pnpm typecheck` (contracts compile) — gate before Phase 2 starts

### Phase 2a: Backend track (sequential within track, parallel with 2b)
- [ ] TASK-002 — reviews module core (routes/service/repository/conflict-detection/run-executor/findings)
- [ ] TASK-003 — Smart Diff latest-per-agent fix

### Phase 2b: Frontend track (sequential within track, parallel with 2a)
- [ ] TASK-004 — data layer, PR-page picker, shared Select-All control, nav item
- [ ] TASK-005 — `/multi-agent-review` pages, `FindingCard`/`VerdictBanner` extensions

### Phase 3: Integration verification (after both tracks land)
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
- [ ] `cd server && pnpm exec vitest run .it.test`
- [ ] `cd client && pnpm test`
- [ ] `cd server && pnpm typecheck && cd client && pnpm typecheck`
- [ ] `./scripts/e2e.sh` — AC-55/56/57 acceptance scenarios end-to-end on demo PR
- [ ] Manual/E2E pass of AC-51 regression check (Timeline/Review Runs parity, unaffected by this feature)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `FindingAction` already has an unused `reply?: string` field; adding `note?: string` alongside it could confuse future readers | Document in TASK-001's PR description / code comment that `reply` is a pre-existing unused stub, `note` is the field this feature actually uses |
| `server/docs/api-contracts.md`'s documented `RunEvent.progress.percent` may contradict the spec's assumed SSE event shape | TASK-005 verifies actual emitted events in `run-executor.ts`/`platform/sse.ts` before implementing AC-63's client formula, rather than trusting either doc |
| `FindingCard` "reuse as-is" (AC-34) vs. required Learn/Reply button additions (AC-35/37) | Treated as an authorized extension (same pattern as `VerdictBanner`, AC-23) since `onAction` was already typed for it; not a fork |
| Frontend track (TASK-004/005) typechecks against contracts before backend routes (TASK-002) exist — risk of building against a shape that later shifts | TASK-001 freezes contracts before Phase 2 starts; Phase 3 integration step re-verifies both tracks together before declaring done |
| Migration path naming mismatch between root `CLAUDE.md` ("drizzle/") and actual repo layout (`server/src/db/migrations/`) | Non-blocking; use verified real path, note the doc drift, do not "fix" the doc as part of this feature (out of scope) |
| `agents/repository.ts` `avg_duration_ms` DTO-assembly call site not confirmed by research | TASK-001 explicitly calls this out as verify-before-editing rather than guessing a path |
| Large surface area (65 ACs, 5 tasks) risks task-boundary drift during implementation | Each task's owned paths are exhaustive and non-overlapping; if an implementer finds a needed file outside their task's owned paths, stop and re-plan rather than silently expanding scope |

## Out of Scope

- `ci/`, `agent-runner/`, `client/src/app/ci/` (do not exist, do not introduce)
- "Compose review" drawer (`ComposeReviewInput`/`ComposedReview`)
- `GET /agents/:id/stats` / `AgentStats` contract (separate future "Agent Performance" feature — confirmed already defined-but-unused in `observability.ts`, not touched)
- New estimate endpoint (reused `GET /agents` instead, per exception #5)
- Any change to `POST /pulls/:id/review`, SSE `RunBus`, `RunTraceDrawer`, `LiveLogStream`, `useRunEvents` signatures
- `listRunsForPull` pagination fix (pre-existing, unrelated)
- Real process/git-worktree isolation for agents
- LLM/embeddings-based conflict matching or reconciliation
- Persona-templated or LLM-generated "why didn't this agent flag it" explanations
- Caching computed conflicts (documented future optimization only)
- Fixing the `client/CLAUDE.md` doc drift on `useRunEvents`'s path (noted, not fixed, as part of this feature)
- Accessibility requirements (not part of this project's scope)

## Architecture Notes

- **Onion layering**: all new reviews-module logic stays in `service.ts` (orchestration) /
  `repository/*.repo.ts` (Drizzle, pure functions, `toDomain`/`toDb` mappers) / `routes.ts` (thin
  Fastify handlers: validate → one service call → reply). `conflict-detection.ts` is a pure
  domain-adjacent function file with zero DB/Fastify imports — swappable per AC-28's explicit
  requirement, callable directly from unit tests.
- **DI**: `container.embedder()` is already an async method (`platform/container.ts:225-237`),
  memoized, gated on secrets presence — call it, do not re-instantiate an embedder anywhere in
  `reviews/`.
- **Cross-module data access**: `memory` table access happens via a new `reviews/repository/memory.repo.ts`
  that imports the `memory` Drizzle table directly from `db/schema/knowledge.ts` (per the spec's
  explicit exception #1) — this is the one place in this feature where a module's repository layer
  reaches into another module's schema file directly, and it's spec-sanctioned, not a new pattern
  to generalize elsewhere.
- **Frontend data layer**: all new fetch/query/mutation logic goes in `client/src/lib/hooks/reviews.ts`
  (existing domain-hooks convention), not inline in components, not new files in `api.ts`.
- **Extend, don't fork**: both `VerdictBanner` (spec-authorized, AC-23) and `FindingCard`
  (necessary-but-not-explicitly-named, see research finding #4 above) get additive optional
  props/UI, never a parallel component.
- **Migrations**: two additive/nullable migrations only, generated via `pnpm db:generate`, never
  hand-edited, applied via `pnpm db:migrate` (never auto-run).
