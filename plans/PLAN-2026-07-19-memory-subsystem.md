# Plan: Memory subsystem

> Status: DRAFT
> Created: 2026-07-19
> Spec: specs/SPEC-2026-07-19-memory-subsystem.md
> Source context: EXPORT_TO_CI_PLAN.md ("Global context" + "SPEC 3 — Memory subsystem" + "SPEC 3 clarifications — RESOLVED")
> Depends on: plans/PLAN-2026-07-19-export-to-ci.md (PR 2 — ships `.devdigest/memory.jsonl` in the CI bundle, initially empty; PR 3 populates it) and plans/PLAN-2026-07-19-agent-runner-findings-artifact.md (PR 1 — owns the agent-runner; clarification 10 places `loadMemory` there).
> Execution Mode: multi-agent — Phase 0 shared prerequisites run first, then three disjoint tracks in parallel: **backend** ∥ **frontend** ∥ **agent-runner**.
> PR ordering: PR 3 of 3 (agent-runner → Export to CI → **Memory**). Merges LAST.

## Requirements (VRF)

> Status: Confirmed. All spec "Clarifications" are RESOLVED (10 items). Three implementation-level decisions surfaced during codebase verification — see Open Questions (watermark store shape, reviews-module boundary, cross-PR snapshot injection).

| ID  | Requirement                                                                                                                                                                                                                                       | Source                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----- |
| R1  | Local review-run selects memory where `scope='global'` OR (`scope='repo'` AND `repoId`=PR's repo), `confidence ≥ 0.7`, and passes their `content` strings into `reviewPullRequest` as `memory: string[]` instead of the current no-`memory` call. | AC-1                              |
| R2  | Zero passing rows → call `reviewPullRequest` without `memory` (identical prompt, no "## Relevant memory" block); never crash.                                                                                                                     | AC-2                              |
| R3  | Memory rows actually included in the prompt have their `lastUsedAt` bumped to the run time.                                                                                                                                                       | AC-3                              |
| R4  | Findings (accept/dismiss) and memory are read READ-ONLY from the shared DB; reviews core logic/schema untouched — only a call-site injection in `run-executor.ts`.                                                                                | AC-4                              |
| R5  | CI export generates `.devdigest/memory.jsonl` as JSONL of rows scope `global`+target repo, `confidence ≥ 0.7`, ordered by `confidence × recency(COALESCE(lastUsedAt, createdAt))` desc.                                                           | AC-5                              |
| R6  | >50 candidates → include only top-50 by that score.                                                                                                                                                                                               | AC-6                              |
| R7  | Zero candidates → empty `memory.jsonl` (0 lines); export does not break (SPEC 2 compatible).                                                                                                                                                      | AC-7                              |
| R8  | Each JSONL line is valid JSON with `content`, `kind`, `scope`, `confidence`, `source`; NO `embedding`.                                                                                                                                            | AC-8                              |
| R9  | Runner `loadMemory()` reads `.devdigest/memory.jsonl` → `memory: string[]`; missing/empty → no `memory`; malformed line → skip & continue.                                                                                                        | AC-9                              |
| R10 | `POST /memory` (`content`+`kind`+`scope`) creates `source='explicit'`, active immediately, no LLM, no pending.                                                                                                                                    | AC-10                             |
| R11 | `scope='repo'` requires `repoId`; `scope='global'                                                                                                                                                                                                 | 'team'`→`repoId` null.            | AC-11 |
| R12 | Empty/whitespace `content` → 422, no row created.                                                                                                                                                                                                 | AC-12                             |
| R13 | Explicit rows default `confidence = 0.9` (clears the 0.7 gate immediately).                                                                                                                                                                       | AC-13                             |
| R14 | Background aggregation with ≥ threshold (3–5) similar dismisses → cheap LLM (`memory_distill`) distills to ONE rule, `source='auto'`.                                                                                                             | AC-14                             |
| R15 | Auto row `confidence = min(0.45 + 0.06 × dismiss_count, 0.9)` — monotonic (3≈0.63, 5≈0.75, cap 0.9).                                                                                                                                              | AC-15                             |
| R16 | Auto row added POST-HOC (active, visible), no pending-approval gate.                                                                                                                                                                              | AC-16                             |
| R17 | Auto row `sources` (jsonb) holds provenance (finding ids / PR refs).                                                                                                                                                                              | AC-17                             |
| R18 | Distillation resolves the model via `resolveFeatureModelStrict(container, wsId, "memory_distill")`; unconfigured → ValidationError, isolated per group (batch continues).                                                                         | AC-18                             |
| R19 | Memory module keeps its OWN watermark (`last_processed_at`); process only `dismissedAt > watermark`, then advance; reviews never written.                                                                                                         | AC-19                             |
| R20 | `confidence < 0.7` excluded from BOTH the local prompt and the CI snapshot (WHERE-clause filter).                                                                                                                                                 | AC-20                             |
| R21 | Delete on the Memory page removes the row so it appears in no future review/snapshot.                                                                                                                                                             | AC-21                             |
| R22 | Auto memory derives ONLY from trusted dismiss signals (finding text the user dismissed) — never raw PR content.                                                                                                                                   | AC-22                             |
| R23 | Every row stores `source` (`explicit                                                                                                                                                                                                              | auto`), surfaced in the DTO + UI. | AC-23 |
| R24 | Memory page in the sidebar: header "Memory" + subtitle + `[+ Add memory]` + `[Refresh]`.                                                                                                                                                          | AC-24                             |
| R25 | Empty state "No memories yet" + explanation + `[+ Add memory]`.                                                                                                                                                                                   | AC-25                             |
| R26 | Table columns CONTENT \| KIND \| SCOPE \| SOURCE \| CONF \| USED \| ⋯; repo → "repo · owner/name", global → "global".                                                                                                                             | AC-26                             |
| R27 | `[Refresh]` re-reads LOCAL DB (no GitHub) and surfaces new auto-learned rows.                                                                                                                                                                     | AC-27                             |
| R28 | Filters scope \| kind \| source \| text search narrow the table server-side.                                                                                                                                                                      | AC-28                             |
| R29 | USED column shows `lastUsedAt`; CI usage does NOT affect it.                                                                                                                                                                                      | AC-29                             |
| R30 | `⋯` menu gives Edit / Delete / view provenance.                                                                                                                                                                                                   | AC-30                             |
| R31 | Add `"memory_distill"` to `FeatureModelId` enum (server `contracts/platform.ts` + client mirror `lib/utils/featureModels.ts`) + a `FEATURE_MODELS` entry (label "Memory · Learning", cheap default e.g. `deepseek/deepseek-v4-flash`).            | AC-31                             |
| R32 | With `memory_distill` in the registry, Settings → Feature Models auto-renders its picker (no extra UI code).                                                                                                                                      | AC-32                             |

## Open Questions & Recommendations

| #        | Question                                                                                                                                                                                   | Answer / Recommendation                                                                                                                                                                                                                                                                                                                                                                                            | Type                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| GAP-1    | **Watermark store shape.** AC-19 needs a memory-owned `last_processed_at` for idempotency. Config KV row vs dedicated table?                                                               | **Default (recommended):** new dedicated table `memory_learning_state` (one row per workspace: `workspace_id` PK/FK, `last_processed_at` timestamptz nullable, `updated_at`). Cleaner to test/advance than a stringly-typed settings key; watermark is workspace-global (all new dismisses read, then grouped by repo in memory). Plan reflects this default.                                                      | gap                    |
| GAP-2 🚩 | **Reviews-module boundary.** The un-stub edits `server/src/modules/reviews/run-executor.ts` — a reviews-module file — and the learning loop reads `findings.dismissedAt` (reviews schema). | Accepted per spec AC-4 / clarifications Q15/Q28: the ONLY reviews-module file this PR edits is `run-executor.ts`, and ONLY as a call-site injection (query `container.memoryRepo`, pass `memory`, bump `lastUsedAt`). No reviews core logic, no reviews schema change, no writes to `findings`. Dismisses are read via a memory-owned read-only repository method that JOINs `findings → reviews → pull_requests`. | 🚩 red flag / accepted |
| GAP-3 🚩 | **Cross-PR snapshot injection.** The `.devdigest/memory.jsonl` file is assembled inside PR2's `ci` module (`assembleFiles`, placeholder empty string). PR3 must make it a real snapshot.   | PR3 provides a PURE serializer `modules/memory/snapshot.ts` + a `memoryRepo.selectForSnapshot()` query, and injects ONE call at PR2's assembly point. Since PR2 merges first with an empty placeholder, this is a small, additive replacement. Risk: if PR2's `assembleFiles` signature differs at merge time, adapt the injection. Confirm the exact PR2 symbol before editing.                                   | 🚩 coordination        |
| GAP-4    | **`loadMemory` placement.** Clarification 10 places `loadMemory` in PR1 (agent-runner). It may already exist by the time PR3 lands.                                                        | Plan it HERE (TASK-008) but guard: if `agent-runner/src/memory.ts` already exists from PR1, only add/confirm tests + `run.ts` wiring; if absent, add it (mirror `loadSkillBodies`). Do not duplicate.                                                                                                                                                                                                              | coordination           |
| 💡-1     | Local read-path vs CI-snapshot query — same filter, different ordering/cap.                                                                                                                | Recommendation: two sibling repository methods sharing a private WHERE builder — `selectForPrompt(wsId, repoId)` (scope+conf≥0.7, no cap) and `selectForSnapshot(wsId, repoId)` (adds `ORDER BY confidence * recency DESC LIMIT 50`). Both filter `confidence ≥ 0.7` in SQL (Non-functional: retrieval filter).                                                                                                    | 💡 recommendation      |

## Affected Modules

| Module                                    | Path                                                      | Change Type                                           |
| ----------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| shared contracts (server)                 | `server/src/vendor/shared/contracts/memory.ts`            | **Add**                                               |
| shared contracts (client mirror)          | `client/src/vendor/shared/contracts/memory.ts`            | **Add** (confirm exact client vendor path)            |
| shared contracts (server) — feature model | `server/src/vendor/shared/contracts/platform.ts`          | Modify (enum + registry)                              |
| feature model registry (client mirror)    | `client/src/lib/utils/featureModels.ts`                   | Modify (add `memory_distill`)                         |
| DB schema (knowledge)                     | `server/src/db/schema/knowledge.ts`                       | Modify (`source` col + `memory_learning_state` table) |
| DB migrations                             | `server/drizzle/**`                                       | Add (generated)                                       |
| DI container                              | `server/src/platform/container.ts`                        | Modify (add `memoryRepo` getter)                      |
| module registry                           | `server/src/modules/index.ts`                             | Modify (one import + one entry)                       |
| backend: `memory` module                  | `server/src/modules/memory/`                              | **Add** (repository/service/routes/learning/snapshot) |
| backend: reviews call-site                | `server/src/modules/reviews/run-executor.ts`              | Modify (un-stub only)                                 |
| backend: ci export injection              | `server/src/modules/ci/` (PR2's `assembleFiles`/service)  | Modify (one call — cross-PR)                          |
| agent-runner: memory loader               | `agent-runner/src/memory.ts` + `agent-runner/src/run.ts`  | **Add**/Modify (or confirm from PR1)                  |
| client: API + hooks                       | `client/src/lib/api.ts`, `client/src/lib/hooks/memory.ts` | Modify / Add                                          |
| client: nav                               | `client/src/vendor/ui/nav.ts`                             | Modify                                                |
| client: Memory page                       | `client/src/app/memory/`                                  | **Add**                                               |

> The client vendor-mirror path for the shared `memory.ts` contract mirrors the existing `client/src/vendor/shared/contracts/eval-ci.ts` convention — the frontend implementer confirms the exact path against the current `client/src/vendor/shared/` layout.

---

## Tasks

### TASK-001: Contracts + Feature Model registry (both mirrors)

**Scope:** both (shared) — Phase 0, blocks backend + frontend tracks.

**Owned Paths:**

- `server/src/vendor/shared/contracts/memory.ts` (new)
- `client/src/vendor/shared/contracts/memory.ts` (new mirror — confirm path)
- `server/src/vendor/shared/contracts/platform.ts`
- `client/src/lib/utils/featureModels.ts`

**Concrete changes:**

- New `memory.ts` (identical in both mirrors): `MemoryScope = z.enum(["repo","global","team"])`, `MemoryKind = z.enum(["decision","convention","preference","fact","learning"])`, `MemorySource = z.enum(["explicit","auto"])`; `MemoryItem` (id, workspaceId, repoId nullable, scope, kind, content, confidence, source, sources nullable, createdAt, updatedAt, lastUsedAt nullable, plus a derived `repoLabel?`/`repoSlug?` for the SCOPE column — or join repo owner/name in the DTO); `MemoryCreateInput` (`content` min(1) trimmed, `kind`, `scope`, `repoId?`) with a `superRefine`: `scope==='repo'` ⇒ `repoId` required, else `repoId` stripped/null; `MemoryUpdateInput` (partial: content/kind/confidence); `MemoryListQuery` (`scope?`, `kind?`, `source?`, `q?`); `MemoryListResponse = { items: MemoryItem[] }`; `MemoryRefreshResult = { learned: number, scanned: number }`.
- `platform.ts`: add `"memory_distill"` to the `FeatureModelId` enum and a `FEATURE_MODELS` entry `{ id:"memory_distill", label:"Memory · Learning", description:"Distills dismissed findings into memory rules.", defaultProvider:"openrouter", defaultModel:"deepseek/deepseek-v4-flash" }`.
- `client/src/lib/utils/featureModels.ts`: add the SAME `memory_distill` entry to the client `FEATURE_MODELS` mirror (do NOT touch the pre-existing missing-`eval` gap — out of scope).
- Re-export `memory.ts` from the shared barrel if the barrel enumerates contracts (match how `eval-ci.ts` is exported).

**Acceptance Criteria:**

- [ ] AC-001 (→ R31/AC-31): `memory_distill` present in both the server enum/registry and the client mirror.
- [ ] AC-002 (→ R11/AC-11): `MemoryCreateInput` enforces repoId-by-scope at the schema level.
- [ ] AC-003 (→ R8/R23): `MemoryItem`/snapshot shape carries `source`; snapshot record type has content/kind/scope/confidence/source and no embedding.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-001 | `cd server && pnpm typecheck` + `cd client && pnpm typecheck` green; registry unit assertion both mirrors contain `memory_distill`. |
| AC-002 | Unit: `MemoryCreateInput.safeParse({scope:'repo'})` fails; `{scope:'global', repoId:x}` → repoId null. |

---

### TASK-002: Schema — `memory.source` + `memory_learning_state` + migration

**Scope:** backend — Phase 0, blocks backend track.

**Owned Paths:**

- `server/src/db/schema/knowledge.ts`
- `server/drizzle/**` (generated only)

**Concrete changes:**

- `memory` table: add `source: text("source", { enum: ["explicit","auto"] }).notNull().default("explicit")`. Do NOT add a `status` column (clarification 6). `embedding` stays nullable/unpopulated.
- Add table `memoryLearningState` (`memory_learning_state`): `workspaceId uuid` PK/FK → `workspaces.id` onDelete cascade, `lastProcessedAt timestamp({withTimezone:true})` nullable, `updatedAt` (default now).
- `cd server && pnpm db:generate` then `pnpm db:migrate`.

**Acceptance Criteria:**

- [ ] AC-004 (→ R23/AC-23): `memory.source` column exists (explicit|auto, default explicit).
- [ ] AC-005 (→ R19/AC-19): `memory_learning_state` exists with `workspace_id` PK + `last_processed_at`.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-004/005 | `pnpm db:generate` + `pnpm db:migrate` succeed; inspect generated SQL for the column + table. |

---

### TASK-003: `memory` module — repository + container wiring

**Scope:** backend. Depends on TASK-001, TASK-002.

**Owned Paths:**

- `server/src/modules/memory/repository.ts`
- `server/src/platform/container.ts` (add `memoryRepo` getter only)

**Concrete changes (repository.ts — the ONLY DB layer for memory):**

- `selectForPrompt(workspaceId, repoId)` → rows where `workspace_id=ws AND (scope='global' OR (scope='repo' AND repo_id=repoId)) AND confidence >= 0.7`. Returns `{ id, content }[]` (id needed to bump lastUsedAt). (R1/R20)
- `selectForSnapshot(workspaceId, repoId)` → same WHERE, `ORDER BY confidence * (recency factor over COALESCE(last_used_at, created_at)) DESC LIMIT 50`. Recency factor = a monotonic function of `COALESCE(last_used_at, created_at)` (e.g. epoch seconds) so ordering is stable; document the exact expression. Returns snapshot fields only (content, kind, scope, confidence, source). (R5/R6/R20)
- `touchLastUsed(ids: string[], at: Date)` → `UPDATE memory SET last_used_at=at WHERE id = ANY(ids)`. (R3)
- `create(input)` (source, confidence, repoId per scope), `list(workspaceId, filters)` (server-side WHERE for scope/kind/source/`q` ILIKE on content; LEFT JOIN `repos` for owner/name to build the SCOPE label), `get`, `update`, `delete`. (R10/R21/R26/R28)
- `insertAuto({ content, kind, scope, repoId, confidence, sources })` → source='auto'. (R14/R16/R17)
- Read-only dismiss reader: `listNewDismisses(workspaceId, since: Date|null)` → JOIN `findings → reviews → pull_requests` returning `{ findingId, prNumber, repoId, category, file, title, rationale, dismissedAt }` where `findings.dismissedAt > since` (or all when null), ordered by `dismissedAt`. NO writes to reviews tables. (R19/R22)
- Watermark: `getWatermark(workspaceId)` / `setWatermark(workspaceId, at)` over `memory_learning_state` (upsert). (R19)
- Container: add `get memoryRepo(): MemoryRepository` (lazy, mirrors `evalsRepo`).

**Acceptance Criteria:**

- [ ] AC-006 (→ R1/R20): `selectForPrompt` applies scope + `confidence>=0.7` in SQL; a 0.5-confidence row is excluded.
- [ ] AC-007 (→ R5/R6): `selectForSnapshot` orders by conf×recency and caps at 50; `last_used_at=null` ranks by `created_at`.
- [ ] AC-008 (→ R19): watermark get/set round-trips; `listNewDismisses` respects `since`.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-006/007/008 | `memory.it.test.ts` (real PG) in TASK-005/006 exercises these; direct repo unit where hermetic. |

---

### TASK-004: Read path (local) — un-stub `run-executor.ts`

**Scope:** backend. Depends on TASK-003. **Only reviews-module file this PR edits (GAP-2).**

**Owned Paths:**

- `server/src/modules/reviews/run-executor.ts`

**Concrete changes:**

- Before the `reviewPullRequest({...})` call (run-executor.ts ~line 388): `const memoryRows = await this.container.memoryRepo.selectForPrompt(workspaceId, pull.repoId);` then spread `...(memoryRows.length > 0 ? { memory: memoryRows.map(m => m.content) } : {})` into the call — matching the existing omit-when-empty pattern used for `skills`/`specs`. (R1/R2)
- After a successful run where memory was included: `await this.container.memoryRepo.touchLastUsed(memoryRows.map(m => m.id), new Date());` (R3)
- Populate the trace: set `memory_pulled: memoryRows.map(m => m.content)` (currently `[]` at ~line 490) so the trace reflects usage; `outcome.assembly` already carries the rendered "## Relevant memory" block into `prompt_assembly.memory`.
- Do NOT modify reviews repository, schema, or any other reviews file. (R4)

**Acceptance Criteria:**

- [ ] AC-009 (→ R1/AC-1): memory content strings reach `reviewPullRequest`; assembled prompt contains "## Relevant memory".
- [ ] AC-010 (→ R2/AC-2): 0 passing rows → `reviewPullRequest` called without `memory`; run completes; no memory block.
- [ ] AC-011 (→ R3/AC-3): used rows have `lastUsedAt` updated after the run.
- [ ] AC-012 (→ R4/AC-4): only `run-executor.ts` changed in reviews/; no reviews schema/core change.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-009/010 | Unit on the executor with a stubbed `memoryRepo` (0 rows vs N rows) → assert the `reviewPullRequest` arg shape. |
| AC-011 | `.it.test` (real PG): seed memory, run, assert `last_used_at` bumped. |
| AC-012 | Code review / `git diff --stat reviews/` shows only `run-executor.ts`. |

---

### TASK-005: `memory` module — explicit write CRUD + auto-learning + routes + register

**Scope:** backend. Depends on TASK-001, TASK-003. Sequential within backend track (shares `service.ts`/`routes.ts`).

**Owned Paths:**

- `server/src/modules/memory/service.ts`
- `server/src/modules/memory/routes.ts`
- `server/src/modules/memory/learning/confidence.ts` (pure)
- `server/src/modules/memory/learning/group.ts` (pure)
- `server/src/modules/memory/learning/distill.ts` (LLM call)
- `server/src/modules/index.ts` (one import + one entry)

**Concrete changes:**

- `MemoryService(container)` (pattern: `new EvalsService(container)`):
  - `create(workspaceId, input)` → repo.create with `source='explicit'`, `confidence=0.9`, repoId per scope; 422 on empty content / repo-without-repoId (Zod in routes + defensive service guard). (R10/R12/R13)
  - `list/get/update/delete` → repo passthroughs. (R21/R26/R28/R30)
  - `refresh(workspaceId)` → returns fresh `list` result AND triggers `runLearning(workspaceId)` (on-demand, no cron). (R27, clarification 1)
  - `runLearning(workspaceId)`:
    1. `since = repo.getWatermark(ws)`; `dismisses = repo.listNewDismisses(ws, since)`. (R19/R22)
    2. `group.ts`: group by `(repoId, category, directory(file))` (repo-scoped; clarification 2). Compute `maxDismissedAt` per batch for the watermark.
    3. For each group with `count >= THRESHOLD` (const, 3): resolve `resolveFeatureModelStrict(container, ws, "memory_distill")` → cheap LLM via `container.llm(provider)`; `distill.ts` sends ONLY dismissed finding text (title/rationale/category/file — never raw PR diff/body) → one generalized rule. (R14/R18/R22)
    4. `confidence.ts`: `autoConfidence(count) = Math.min(0.45 + 0.06 * count, 0.9)`. (R15)
    5. `repo.insertAuto({ content, kind:'learning', scope:'repo', repoId, confidence, sources: { findingIds, prNumbers } })`. (R16/R17)
    6. Wrap each group in try/catch so an unconfigured-model / LLM failure isolates to that group; others in the batch proceed. (R18)
    7. After the batch: `repo.setWatermark(ws, maxDismissedAt)`. (R19)
- Routes (Fastify plugin, `withTypeProvider<ZodTypeProvider>()`, `getContext`, `IdParams`):
  - `POST /memory` (body `MemoryCreateInput`) → 201 `MemoryItem`.
  - `GET /memory` (querystring `MemoryListQuery`) → `MemoryListResponse`.
  - `PATCH /memory/:id` (body `MemoryUpdateInput`) → 200 `MemoryItem`.
  - `DELETE /memory/:id` → 204.
  - `POST /memory/refresh` → `MemoryRefreshResult` (re-read local DB + trigger `runLearning`; mirrors `polling/routes.ts` manual-refresh precedent).
- `index.ts`: `import memory from "./memory/routes.js";` + `memory,` in the `modules` record.

**Acceptance Criteria:**

- [ ] AC-013 (→ R10/R13/AC-10/13): POST explicit → `source='explicit'`, `confidence=0.9`, active; next local review picks it up.
- [ ] AC-014 (→ R11/R12/AC-11/12): scope=repo without repoId → 422; empty content → 422; scope=global with repoId → repoId null.
- [ ] AC-015 (→ R14/R16/R17/AC-14/16/17): 3 similar dismisses (LLM stubbed) → 1 `source='auto'` row, active, `sources` populated.
- [ ] AC-016 (→ R15/AC-15): `autoConfidence` — 3→~0.63, 5→~0.75, cap 0.9, monotonic.
- [ ] AC-017 (→ R18/AC-18): unconfigured `memory_distill` → ValidationError for that group; other groups still learn.
- [ ] AC-018 (→ R19/AC-19): re-running over the same dismisses creates no duplicate; watermark advanced.
- [ ] AC-019 (→ R21/AC-21): DELETE → row gone from subsequent `selectForPrompt`/`selectForSnapshot`.
- [ ] AC-020 (→ R1/AC-7): `memory` registered in `index.ts`; server boots; routes reachable.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-016 | Unit `confidence.test.ts` (hermetic) — table of counts. |
| AC-013/014/015/017/018/019 | `memory.it.test.ts` (real PG, LLM stubbed via `ContainerOverrides.llm`). |
| AC-020 | `grep index.ts`; boot smoke. |

---

### TASK-006: CI export snapshot — pure serializer + inject into PR2 `ci` export

**Scope:** backend. Depends on TASK-003. **Cross-PR coordination (GAP-3).**

**Owned Paths:**

- `server/src/modules/memory/snapshot.ts` (pure)
- injection point in PR2's `ci` module (`assembleFiles` / export service — confirm exact symbol before editing)

**Concrete changes:**

- `snapshot.ts`: `memoryJsonl(rows: SnapshotRecord[]): string` → one JSON object per line with EXACTLY `content, kind, scope, confidence, source` (no embedding), joined by `\n`; empty array → `""`. (R7/R8)
- `buildMemorySnapshot(container, workspaceId, repoId)` = `memoryJsonl(await container.memoryRepo.selectForSnapshot(workspaceId, repoId))`. (R5/R6)
- Inject: replace PR2's empty `.devdigest/memory.jsonl` placeholder in `assembleFiles`/export service with a call to `buildMemorySnapshot(...)` for the export's target repo. Applies to both `POST /agents/:id/export-ci` and "Update CI config". Do NOT ship embeddings; `lastUsedAt` is NOT bumped on export (clarification: CI usage not counted). (R5/R6/R7/R29)

**Acceptance Criteria:**

- [ ] AC-021 (→ R5/R6/AC-5/6): 60 candidates → exactly 50 top-ranked lines, ordered conf×recency; null lastUsedAt ranks by createdAt.
- [ ] AC-022 (→ R7/R8/AC-7/8): 0 candidates → `""`; each line `JSON.parse`-able with the 5 fields and no `embedding`.
- [ ] AC-023 (→ R20/AC-20): a `confidence=0.5` row appears in neither the snapshot nor `selectForPrompt`.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-021/022 | Unit `snapshot.test.ts` (hermetic) over fixture rows. |
| AC-023 | `.it.test` shared with TASK-005 (seed 0.5-conf row, assert absent from both paths). |

---

### TASK-007: agent-runner — `loadMemory()` (mirror `loadSkillBodies`)

**Scope:** agent-runner (independent track). **Coordinate with PR1 (GAP-4) — may already exist.**

**Owned Paths:**

- `agent-runner/src/memory.ts` (new, or confirm from PR1)
- `agent-runner/src/run.ts` (wire `memory` into `reviewPullRequest`)
- `agent-runner/src/memory.test.ts`

**Concrete changes:**

- `loadMemory(devdigestDir, readFile = readFileSync): string[]` — read `.devdigest/memory.jsonl`; file missing → `[]`; for each non-empty line, `try { JSON.parse(line).content }`—on parse error or missing `content`, SKIP the line and continue (do not throw). (R9, clarification 9)
- `run.ts`: after `loadSkillBodies`, `const memory = loadMemory(devdigestDir);` and spread `...(memory.length > 0 ? { memory } : {})` into the `reviewPullRequest` call (same omit-when-empty contract). (R9)
- If PR1 already added this: only reconcile tests + wiring; do not duplicate.

**Acceptance Criteria:**

- [ ] AC-024 (→ R9/AC-9): file → content array; missing file → `[]`; malformed lines skipped, valid lines kept; runner does not crash.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-024 | `cd agent-runner && npm test` — `memory.test.ts` covers present/missing/malformed. |

---

### TASK-008: Client — API + hooks + nav

**Scope:** frontend. Depends on TASK-001. Blocks TASK-009.

**Owned Paths:**

- `client/src/lib/api.ts`
- `client/src/lib/hooks/memory.ts` (new)
- `client/src/vendor/ui/nav.ts`

**Concrete changes:**

- `api.ts`: `getMemory(query)`, `createMemory(body)`, `updateMemory(id, body)`, `deleteMemory(id)`, `refreshMemory()` — via `apiFetch`; query keys colocated.
- `hooks/memory.ts`: `useMemory(filters)`, `useCreateMemory()`, `useUpdateMemory()`, `useDeleteMemory()`, `useRefreshMemory()` (mutation → invalidate `memory`). Refresh reads LOCAL DB only — no GitHub. (R27)
- `nav.ts`: add a "Memory" item (global, sidebar) → `/memory`, choosing an `IconName` from `./icons`; optional `SHORTCUTS` entry.

**Acceptance Criteria:**

- [ ] AC-025 (→ R24): nav item "Memory" → `/memory`.
- [ ] AC-026 (→ R27): `useRefreshMemory` invalidates local `memory` query; no GitHub fetch.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-025 | Render sidebar → Memory present, routes to `/memory`. |
| AC-026 | Hook test: mutation invalidates `memory` key; no network to GitHub. |

---

### TASK-009: Client — Memory page

**Scope:** frontend. Depends on TASK-008.

**Owned Paths:**

- `client/src/app/memory/**` (page, table, filters, add/edit modal, provenance popover, empty state)

**Concrete changes:**

- Header "Memory" + subtitle "What your agents have learned about this codebase" + `[+ Add memory]` + `[Refresh]` (`useRefreshMemory`). (R24/R27)
- Empty state "No memories yet" + explanation + `[+ Add memory]`. (R25)
- Filters: scope | kind | source | text search → `useMemory(filters)` (server-side). (R28)
- Table columns CONTENT | KIND | SCOPE | SOURCE | CONF | USED | ⋯. SCOPE: repo → "repo · owner/name" (from the DTO's repo label), global → "global". USED renders `lastUsedAt` relative ("2d ago"). (R26/R29)
- `+ Add memory` modal: form content + kind + scope (v1 offers ONLY global + repo — team omitted, clarification 7); scope=repo reveals a repo picker; submit → `useCreateMemory`. (R10/R11)
- `⋯` menu: Edit (modal → `useUpdateMemory`) / Delete (`useDeleteMemory`) / view provenance (render `sources`: "added by you" for explicit, "learned from N dismisses" for auto). (R30/R23)
- i18n via `useTranslations()`; no hardcoded JSX strings.
- Settings → Feature Models auto-renders the `memory_distill` picker from the registry — no page code needed here (verify only). (R32)

**Acceptance Criteria:**

- [ ] AC-027 (→ R24/R25/AC-24/25): header + `[+ Add memory]` + `[Refresh]`; empty DB → empty state.
- [ ] AC-028 (→ R26/AC-26): repo row → "repo · owner/name"; global row → "global".
- [ ] AC-029 (→ R28/R30/AC-28/30): filters narrow; `⋯` gives Edit/Delete/provenance; source=auto filter shows only auto.
- [ ] AC-030 (→ R32/AC-32): "Memory · Learning" picker appears in Settings → Feature Models.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-027/028/029 | Component tests (vitest + jsdom) with mocked hooks; optional e2e. |
| AC-030 | Manual/e2e: Settings renders the picker. |

---

## Implementation Phases

> ⚙️ Execution mode: **multi-agent** — Phase 0 shared prereqs (TASK-001, TASK-002) run first; then **backend** (TASK-003 → TASK-004 ∥ TASK-005 ∥ TASK-006, sequential within the track) ∥ **frontend** (TASK-008 → TASK-009) ∥ **agent-runner** (TASK-007). Owned paths are disjoint across the three tracks.

### Phase 0: Shared prerequisites (block dependents)

- [ ] TASK-001 — contracts `memory.ts` (both mirrors) + `memory_distill` feature model (both mirrors)
- [ ] TASK-002 — schema `memory.source` + `memory_learning_state`; `pnpm db:generate` then `pnpm db:migrate`

### Phase 1: Backend

- [ ] TASK-003 — `memory/repository.ts` + `container.memoryRepo`
- [ ] TASK-004 — un-stub `reviews/run-executor.ts` (call-site injection only)
- [ ] TASK-005 — `memory/service.ts` + `routes.ts` + `learning/*` + register in `index.ts`
- [ ] TASK-006 — `memory/snapshot.ts` + inject into PR2 `ci` export

### Phase 2: agent-runner (parallel)

- [ ] TASK-007 — `loadMemory()` + `run.ts` wiring (or confirm from PR1)

### Phase 3: Frontend (parallel)

- [ ] TASK-008 — `api.ts` + `hooks/memory.ts` + `nav.ts`
- [ ] TASK-009 — `app/memory/**` page

### Phase 4: Tests (per task; see self-verification)

- [ ] Unit: `confidence.test.ts`, `snapshot.test.ts`, `group.test.ts`, executor arg-shape, agent-runner `memory.test.ts`
- [ ] Integration: `server/src/modules/memory/memory.it.test.ts` (real PG, LLM stubbed)

## Self-verification checklist

- [ ] `cd server && pnpm typecheck` green
- [ ] `cd client && pnpm typecheck` green
- [ ] `cd agent-runner && npm run typecheck` green
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — unit incl. confidence curve (3≈0.63 / 5≈0.75 / cap 0.9 / monotonic), snapshot selection (top-50, conf×recency, null→createdAt, empty→""), snapshot record shape (5 fields, no embedding), executor omit-when-empty
- [ ] `cd server && pnpm exec vitest run .it.test` — explicit add (source=explicit, conf 0.9, picked up by read-path), auto-learn (≥3 dismisses → 1 auto row, LLM stubbed, sources populated, watermark idempotent, per-group isolation), read-path (lastUsedAt bumped), governance (conf<0.7 excluded both paths, DELETE removes from both)
- [ ] `cd agent-runner && npm test` — loadMemory present/missing/malformed
- [ ] `cd client && pnpm test` — Memory page (empty state, SCOPE label, filters, ⋯ menu), hooks (refresh invalidates local, no GitHub)
- [ ] `cd server && pnpm db:generate` produced a migration; `pnpm db:migrate` applies clean
- [ ] `git diff --stat server/src/modules/reviews/` shows ONLY `run-executor.ts`

## Test split

- **Unit (hermetic):** confidence curve, snapshot serializer + selection ordering, dismiss grouping, executor arg-shape (stubbed memoryRepo), agent-runner loadMemory, contract/registry mirrors.
- **Integration (`*.it.test.ts`, real PG, LLM stubbed via `ContainerOverrides.llm`):** explicit CRUD, auto-learning end-to-end (grouping → distill → insertAuto → watermark), read-path lastUsedAt, governance threshold + delete across both read paths.
- **Client (vitest + jsdom):** Memory page + hooks.

## Risks & Mitigations

| Risk                                                        | Mitigation                                                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🚩 Un-stub touches the reviews module (`run-executor.ts`).  | Call-site injection ONLY (TASK-004 owns just that file); read-only memory query; no reviews schema/core/write change; verified by `git diff --stat reviews/` (AC-012).                                         |
| 🚩 Dismiss read crosses into reviews' `findings` table.     | Read-only JOIN in the memory repository; NEVER write to reviews; watermark lives in the memory-owned `memory_learning_state` (AC-019).                                                                         |
| 🚩 Snapshot injection edits PR2's `ci` module (cross-PR).   | PR3 provides a pure serializer + repo query and injects ONE call; confirm PR2's `assembleFiles` symbol at merge time; PR2's empty placeholder keeps export working if injection is deferred (AC-7 compatible). |
| `loadMemory` may already exist in PR1.                      | TASK-007 guards: confirm-or-add; do not duplicate (clarification 10).                                                                                                                                          |
| Prompt poisoning via memory.                                | Distillation input = only user-dismissed finding text, never raw PR content (AC-22); 0.7 gate quarantines fresh low-confidence auto rules (AC-15/20); post-hoc delete (AC-21).                                 |
| Unconfigured `memory_distill` model breaks a whole refresh. | Per-group try/catch isolates ValidationError; watermark advances only over processed groups (AC-18/19).                                                                                                        |
| Client shared-contract mirror path uncertainty.             | Frontend implementer confirms the client vendor path against the existing `eval-ci.ts` mirror before adding `memory.ts`.                                                                                       |

## Out of Scope (v2)

- Memory decay, full audit-log, dedup, embeddings generation (embedding column stays nullable/unpopulated).
- Per-agent / agent-scoped memory (memory stays purely shared — no `agentId`).
- Pending-approval gate for auto memory (post-hoc delete only).
- Live CI retrieval (runner reads a static snapshot file only).
- `team`-scope in the add-form (enum retained for the future).
- Counting CI usage in `lastUsedAt`.

## Architecture Notes

- New feature = new module `server/src/modules/memory/`; the ONLY existing files touched are `run-executor.ts` (call-site un-stub), `container.ts` (one getter), `index.ts` (one entry), `platform.ts` (feature model), and the PR2 `ci` assembly point (one call).
- Onion layering: `repository.ts` is the sole DB layer; `service.ts` orchestrates; `learning/*` split into pure (`confidence`, `group`) + LLM (`distill`) for hermetic unit tests; `routes.ts` holds Fastify + Zod HTTP schemas only.
- Model resolution goes through `resolveFeatureModelStrict(container, wsId, "memory_distill")` — never the review model, never `process.env`.
- All `confidence >= 0.7` filtering is a SQL WHERE clause (Non-functional: retrieval filter), not app-memory.
- Client server-state via TanStack Query; keys + fetches in `api.ts`/`hooks/memory.ts`; shared contracts imported from `@devdigest/shared`, never redefined.
