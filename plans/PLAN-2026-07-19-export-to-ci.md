# Plan: Export to CI

> Status: DRAFT
> Created: 2026-07-19
> Spec: specs/SPEC-2026-07-19-export-to-ci.md
> Source context: EXPORT_TO_CI_PLAN.md (Global context + "SPEC 2 — Export to CI" + "SPEC 2 clarifications — RESOLVED")
> Depends on: plans/PLAN-2026-07-19-agent-runner-findings-artifact.md (PR 1 — adds `CiResultArtifact.findings: Finding[]`, consumed by this PR's ingest)
> Execution Mode: multi-agent (Phase 0 shared prerequisites run first, then a backend track ∥ a frontend track with disjoint owned paths)
> PR ordering: PR 2 of 3 (agent-runner → **Export to CI** → Memory).

## Requirements (VRF)

> Status: Confirmed (all spec "Clarifications" are RESOLVED; one implementation gap surfaced — see Open Questions GAP-1).

| ID  | Requirement                                                                                                                                                                                                                                                                                                                                                            | Source                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R1  | New backend module `server/src/modules/ci/` (routes + service + repository) following the `reviews`/`evals` module pattern and onion-architecture; registered once in `server/src/modules/index.ts`.                                                                                                                                                                   | AC-1, AC-7              |
| R2  | `POST /agents/:id/export-ci` (`action=open_pr`) generates manifest YAML + one skill `.md` per linked skill + self-contained `workflow.yml` + `.devdigest/memory.jsonl` + `.devdigest/runner/index.js`, assembles `CiFile[]`, atomically commits to branch `devdigest/ci` + opens a PR, upserts one `ci_installation`, returns `CiExport{installation, files, pr_url}`. | AC-1                    |
| R3  | Export reads pre-built `agent-runner/dist/index.js` from disk; if missing → error advising `pnpm --dir agent-runner build`; never `child_process`-builds in the HTTP handler.                                                                                                                                                                                          | AC-2                    |
| R4  | Slugs computed on the fly (kebab-case + `-2/-3` collision suffix per bundle); no DB slug column.                                                                                                                                                                                                                                                                       | AC-3                    |
| R5  | `CiFile.editable=false` for all derived files; `true` only for `workflow.yml`.                                                                                                                                                                                                                                                                                         | AC-4                    |
| R6  | `action=files` returns a **server-side** zip (paths preserved, incl. runner bundle) and creates **no** `ci_installation`.                                                                                                                                                                                                                                              | AC-5                    |
| R7  | "Update CI config" = same server op, silent, re-exports to ALL installations (upsert by (agent_id, repo)), no wizard.                                                                                                                                                                                                                                                  | AC-6                    |
| R8  | Export Wizard = 4 steps on `ExportWizardSteps` (Target → Preview → Configure → Install); both "Add to CI" and "+ Add repository" open the SAME wizard.                                                                                                                                                                                                                 | AC-8                    |
| R9  | Target step: 4 cards, only GitHub Actions selectable; CircleCI/Jenkins/CLI DISABLED "Coming soon"; `target` defaults `"gha"`.                                                                                                                                                                                                                                          | AC-9                    |
| R10 | Preview shows 5 readable files (manifest, skills/\*.md, memory.jsonl, workflow.yml) with left selector + right content; runner bundle committed but NOT previewed.                                                                                                                                                                                                     | AC-10                   |
| R11 | Only `workflow.yml` editable, in a CodeMirror-6 YAML editor (highlight + auto-indent + line numbers); other files read-only monospace.                                                                                                                                                                                                                                 | AC-11                   |
| R12 | Invalid YAML (`yaml.parse` throws) HARD-blocks Continue/Install with a syntax error.                                                                                                                                                                                                                                                                                   | AC-12                   |
| R13 | Structural security-lint violations SOFT-warn (do not block Install), framed as an assist not a Phase-2 replacement.                                                                                                                                                                                                                                                   | AC-13                   |
| R14 | Workflow edits held in wizard React-state (Variant A, no Save); survive Back/Continue; committed only at Install; discarded on modal close.                                                                                                                                                                                                                            | AC-14                   |
| R15 | Configure step: trigger checkboxes (opened=on, synchronize=on, reopened=off) → `on.pull_request.types`; "Post results as" radio (`github_review`\|`pr_comment`\|`none`) each with static label+desc + a dynamic hint block that changes per selection; static merge-block hint at bottom.                                                                              | AC-15                   |
| R16 | Install step: "Open a PR" (open_pr, branch `devdigest/ci`, creates installation) + "Copy files as a zip" (files, server-side zip, no installation) + help link to docs.github.com/en/actions.                                                                                                                                                                          | AC-16                   |
| R17 | CI tab: "Active in N repos" badge = COUNT(ci_installations) for the agent.                                                                                                                                                                                                                                                                                             | AC-17                   |
| R18 | Installation rows show repo + target_type + last `ci_run` STATUS + last `ran_at` (latest-run join/subquery); "No runs yet" when none.                                                                                                                                                                                                                                  | AC-18                   |
| R19 | "Fail CI on" selector (Critical\|Warning+\|Never) updates `agents.ci_fail_on` in DB; NO silent auto-push (reaches CI only on next Update CI config).                                                                                                                                                                                                                   | AC-19                   |
| R20 | "Update CI config" DISABLED + tooltip "No repos yet — use Add to CI" when the agent has zero installations.                                                                                                                                                                                                                                                            | AC-43                   |
| R21 | Nav item "CI Runs" under SKILLS LAB → `/ci`; page has title, subtitle "Agent reviews executed inside CI · not local runs", `AutoTriggerStatus`, manual Refresh.                                                                                                                                                                                                        | AC-20                   |
| R22 | `GET /ci-runs` applies filters server-side: `from`/`to` (ISO), `agent`, `repo`, `status`, `source`(=target_type).                                                                                                                                                                                                                                                      | AC-21                   |
| R23 | CI Runs table columns: TIMESTAMP \| PULL REQUEST (#num + title) \| AGENT \| SOURCE \| DUR. \| FINDINGS \| COST \| STATUS \| Trace.                                                                                                                                                                                                                                     | AC-22                   |
| R24 | FINDINGS column reuses `SeverityChip` + `FindingsPopover` over ingested individual findings (from PR 1).                                                                                                                                                                                                                                                               | AC-23                   |
| R25 | Findings sorted at RENDER time (severity → file:line); artifact is unordered.                                                                                                                                                                                                                                                                                          | AC-24                   |
| R26 | Trace opens a lightweight drawer (agent, PR#+title, source, status, duration, cost, severity breakdown, timestamp) + "View full logs on GitHub Actions" → `ci_runs.github_url`; no prompt/tool/raw.                                                                                                                                                                    | AC-25                   |
| R27 | Empty state "No CI runs yet" + explanation + CTA "+ Set up CI for an agent" → `/agents`.                                                                                                                                                                                                                                                                               | AC-26                   |
| R28 | Ingest fires ONE request on `/ci` mount (`refetchOnMount`) or manual Refresh; no interval/background poller; zero auto-requests if `/ci` never opened.                                                                                                                                                                                                                 | AC-27                   |
| R29 | Ingest issues per-installation conditional request with `If-None-Match` (stored ETag); 304 → no-op; 200 → ingest + update stored ETag.                                                                                                                                                                                                                                 | AC-28                   |
| R30 | `listWorkflowRuns` returns status + conclusion; ingest only COMPLETED runs (skip in-progress/queued).                                                                                                                                                                                                                                                                  | AC-29                   |
| R31 | Completed run: download `devdigest-result.json` (`downloadArtifact`), `CiResultArtifact.safeParse`, upsert `ci_runs`, create `agent_runs(source='ci')`, persist individual findings.                                                                                                                                                                                   | AC-30                   |
| R32 | Fetch PR title from GitHub during ingest → `ci_runs.pr_title`.                                                                                                                                                                                                                                                                                                         | AC-31                   |
| R33 | Status derivation: in_progress/queued → running; completed + NO artifact + conclusion=failure → failed; completed + artifact + findings>0 → succeeded; completed + artifact + findings===0 → no_findings. **failed ONLY when artifact ABSENT.**                                                                                                                        | AC-32, AC-33            |
| R34 | `AutoTriggerStatus` shows last-synced time ("synced 2m ago"), not "polling".                                                                                                                                                                                                                                                                                           | AC-34                   |
| R35 | Migration adds `ci_runs`: `pr_title`, `duration_ms`, `critical`, `warning`, `suggestion`; NO `verdict`/`agent`/`source-column`/`workflow_version`/`suspended_at`.                                                                                                                                                                                                      | AC-35, AC-36            |
| R36 | Separate migration adds `ci_installations`: `last_synced_etag` (text, nullable) + `last_synced_at` (timestamp, nullable).                                                                                                                                                                                                                                              | AC-42                   |
| R37 | `GitHubClient` gains `listWorkflowRuns` (status + conclusion + artifact refs + ETag, conditional) and `downloadArtifact`, implemented in Octokit adapter + mock.                                                                                                                                                                                                       | AC-37                   |
| R38 | Both `eval-ci.ts` mirrors (server + client) kept identical for any `CiRun`/`CiResultArtifact` shape change.                                                                                                                                                                                                                                                            | AC-38                   |
| R39 | Generated `workflow.yml`: `permissions:` exactly `{contents:read, pull-requests:write}`; secret only via `${{ secrets.OPENROUTER_API_KEY }}`; no `pull_request_target`; runner invoked as `node .devdigest/runner/index.js` (no marketplace action / no npm install).                                                                                                  | AC-39, AC-40, AC-41     |
| R40 | Client deps added: CodeMirror 6 (`@codemirror/lang-yaml`) + `yaml`. NOT Monaco, NOT JSZip.                                                                                                                                                                                                                                                                             | Non-functional (Bundle) |
| R41 | Untrusted inputs handled as data: escape `pr_title` at render; `CiResultArtifact.safeParse` before any DB write (invalid → skip run, don't crash).                                                                                                                                                                                                                     | Untrusted inputs        |

## Open Questions & Recommendations

| #        | Question                                                                                                                                                                                                                                                                                                                                                                                                                                   | Answer / Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Type              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| GAP-1 🚩 | **Findings persistence mechanism.** AC-30/AC-36 require storing individual findings "linked to `agent_runs(source='ci')`", but the existing `findings` table (`server/src/db/schema/reviews.ts`) FKs `review_id → reviews.pr_id → pull_requests` — CI runs have no local `pull_requests` row. AC-35 also forbids extra `ci_runs` columns. How do we persist CI findings without touching reviews core or adding a synthetic PR/review row? | **Default (recommended):** add a NEW ci-module-owned table `ci_run_findings` (FK `ci_run_id → ci_runs`, mirroring the `Finding` shape: file, start_line, end_line, severity, category, title, rationale, suggestion, confidence, kind, confidence). This is additive (not a forbidden `ci_runs` column), keeps `reviews/` untouched, and lets `GET /ci-runs` join findings for `SeverityChip`/`FindingsPopover`. The AC "linked to agent_run" is honored via the 1:1 `ci_run ↔ agent_run(source='ci')`. Plan reflects this default. | 🚩 red flag / gap |
| 💡-1     | Does the CI Runs page need `agent_runs` findings at all, or can it read from `ci_run_findings` directly?                                                                                                                                                                                                                                                                                                                                   | **Recommendation:** page reads embedded `findings: Finding[]` off the `CiRun` DTO (joined from `ci_run_findings`). `agent_runs(source='ci')` row is still created for local-run parity/observability (AC-30) but is NOT the read path for the FINDINGS column.                                                                                                                                                                                                                                                                      | 💡 recommendation |
| 💡-2     | Client mirror of `vendor/shared/adapters.ts` (the `GitHubClient` port)?                                                                                                                                                                                                                                                                                                                                                                    | The port is server-only (never consumed client-side). Only the `eval-ci.ts` contract mirror must stay in sync (AC-38). If a client `adapters.ts` mirror exists, no port-method sync is required there.                                                                                                                                                                                                                                                                                                                              | 💡 recommendation |

## Affected Modules

| Module                    | Path                                                           | Change Type                                    |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| shared contracts (server) | `server/src/vendor/shared/contracts/eval-ci.ts`                | Modify                                         |
| shared contracts (client) | `client/src/vendor/shared/contracts/eval-ci.ts`                | Modify                                         |
| DB schema (CI)            | `server/src/db/schema/ci.ts`                                   | Modify                                         |
| DB migrations             | `server/drizzle/**` (generated)                                | Add                                            |
| GitHubClient port         | `server/src/vendor/shared/adapters.ts`                         | Modify                                         |
| Octokit adapter           | `server/src/adapters/github/octokit.ts`                        | Modify                                         |
| Mock adapters             | `server/src/adapters/mocks.ts`                                 | Modify                                         |
| DI container              | `server/src/platform/container.ts`                             | Modify (add `ciRepo` getter)                   |
| Module registry           | `server/src/modules/index.ts`                                  | Modify (one import + one entry)                |
| backend: `ci` module      | `server/src/modules/ci/`                                       | **Add** (routes/service/repository/generators) |
| client: API + hooks       | `client/src/lib/api.ts`, `client/src/lib/hooks/ci.ts`          | Modify / Add                                   |
| client: nav               | `client/src/vendor/ui/nav.ts`                                  | Modify                                         |
| client: CI Runs page      | `client/src/app/ci/`                                           | **Add**                                        |
| client: Export Wizard     | `client/src/app/agents/_components/ExportWizard/` (co-located) | **Add**                                        |
| client: agent CI tab      | `client/src/app/agents/[id]/` (CI tab)                         | Modify / Add                                   |
| client deps               | `client/package.json`                                          | Modify (CodeMirror 6 + `yaml`)                 |

> Exact `agents` page sub-paths (`[id]`, `_components`) to be confirmed by the frontend implementer against the current `client/src/app/agents/` layout; owned-path guarantee: everything under `client/src/app/agents/` + `client/src/app/ci/` belongs to the frontend track.

---

## Tasks

### TASK-001: Contracts — extend `eval-ci.ts` (both mirrors)

**Scope:** both (shared contract) — Phase 0, blocks all other tasks.

**Owned Paths:**

- `server/src/vendor/shared/contracts/eval-ci.ts`
- `client/src/vendor/shared/contracts/eval-ci.ts`

**Concrete changes (identical in both mirrors):**

- Extend `CiRun` with the ingest/join fields the CI Runs table needs: `pr_title` (nullable), `duration_ms` (nullable), `critical`/`warning`/`suggestion` (nullable ints), `target_type` (`CiTarget`, from installation join), `agent` (already `nullish`), and `findings: z.array(Finding)` (default `[]`, joined from `ci_run_findings`). Keep existing fields.
- Extend `CiInstallation` response usage: add a `CiInstallationRow = CiInstallation.extend({ last_run_status, last_ran_at })` and a `CiInstallationsResponse = { installations: CiInstallationRow[], active_count }` for `GET /agents/:id/ci-installations`.
- Add `CiRunsQuery` (`from`, `to`, `agent`, `repo`, `status`, `source` — all optional) and `CiRunsResponse = { runs: CiRun[] }`.
- Add `CiRefreshResult = { synced_at, ingested, installations_checked }` and optional `repo` filter on the refresh input.
- Rely on PR 1's `CiResultArtifact.findings: Finding[]` (already added by PLAN-2026-07-19-agent-runner-findings-artifact) — do NOT re-add.

**Acceptance Criteria:**

- [ ] AC-001 (→ R38/AC-38): `CiRun`/response shapes identical byte-for-byte between the two mirrors.
- [ ] AC-002 (→ R22/AC-21): `CiRunsQuery` covers `from,to,agent,repo,status,source`.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-001 | `cd server && pnpm typecheck` + `cd client && pnpm typecheck` green; `diff` of the CI blocks between mirrors → empty. |
| AC-002 | Route in TASK-006 typechecks against `CiRunsQuery`. |

---

### TASK-002: Migrations — `ci_runs` columns + `ci_installations` ETag columns (two separate migrations)

**Scope:** backend — Phase 0, blocks backend track.

**Owned Paths:**

- `server/src/db/schema/ci.ts`
- `server/drizzle/**` (generated only — never hand-edited)

**Concrete changes:**

- `ciRuns`: add `prTitle` (text), `durationMs` (integer), `critical` (integer), `warning` (integer), `suggestion` (integer). Do NOT add `verdict`, `agent`, `source`-as-column, `workflow_version`, `suspended_at`.
- `ciInstallations`: add `lastSyncedEtag` (text, nullable) + `lastSyncedAt` (timestamp withTimezone, nullable).
- Add new table `ciRunFindings` (GAP-1 default): `id` uuid pk, `ciRunId` uuid FK → `ciRuns.id` `onDelete: cascade`, plus Finding columns (`file`, `startLine`, `endLine`, `severity`, `category`, `title`, `rationale`, `suggestion` nullable, `confidence`, `kind` default `'finding'`).
- Run `cd server && pnpm db:generate` **twice** to produce SEPARATE migrations: (a) `ci_runs` columns + `ci_run_findings`; (b) `ci_installations` ETag columns (AC-42 mandates a separate migration from `ci_runs`). Then `pnpm db:migrate`.

**Acceptance Criteria:**

- [ ] AC-003 (→ R35/AC-35): `ci_runs` has the 5 new columns; `verdict`/`workflow_version` absent.
- [ ] AC-004 (→ R36/AC-42): `ci_installations` has `last_synced_etag` + `last_synced_at`, in a migration file separate from the `ci_runs` one.
- [ ] AC-005 (→ GAP-1): `ci_run_findings` table exists with FK to `ci_runs`.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-003/004/005 | `pnpm db:generate` (×2) + `pnpm db:migrate` succeed; inspect generated SQL for the columns/table; two distinct migration files. |

---

### TASK-003: GitHubClient port + Octokit adapter + mock

**Scope:** backend.

**Owned Paths:**

- `server/src/vendor/shared/adapters.ts`
- `server/src/adapters/github/octokit.ts`
- `server/src/adapters/mocks.ts`

**Concrete changes:**

- In `adapters.ts` `GitHubClient` interface add:
  - `listWorkflowRuns(repo: RepoRef, opts: { workflowFile?: string; etag?: string | null }): Promise<{ notModified: boolean; etag: string | null; runs: WorkflowRun[] }>` where `WorkflowRun = { id, status, conclusion, prNumber?, headSha?, htmlUrl, artifacts: { id, name }[] }` (define the supporting types here or in a small local interface block — port types stay in `adapters.ts`, matching `CommitFile`/`CommitFilesPayload`).
  - `downloadArtifact(repo: RepoRef, artifactId: number | string): Promise<Buffer>` (raw zip; caller unzips `devdigest-result.json`).
- `OctokitGitHubClient`: implement both via `octokit.rest.actions.listWorkflowRunsForRepo` / `listWorkflowRunArtifacts` / `downloadArtifact`, wrapped in the existing `withRetry(withTimeout(...))`. Pass `If-None-Match: etag` header and detect `304` → `{ notModified: true }`; capture the response `etag` header on `200`.
- `MockGitHubClient`: add configurable `workflowRuns`, `artifacts` (path/id → JSON buffer), and `etag` fixtures to `MockGitHubOptions`; record calls so `.it.test` can assert conditional-request behavior and 304 no-op.

**Acceptance Criteria:**

- [ ] AC-006 (→ R37/AC-37): both methods in the interface + Octokit + mock; server + client typecheck green.
- [ ] AC-007 (→ R29/AC-28): mock supports 304 (`notModified`) and 200-with-etag paths.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-006 | `cd server && pnpm typecheck`; `.it.test` (TASK-007) uses the mock. |
| AC-007 | Unit/it: mock returns `notModified` when the fixture etag matches the request etag. |

---

### TASK-004: `ci` module — generators (pure functions)

**Scope:** backend.

**Owned Paths:**

- `server/src/modules/ci/generators/manifest.ts`
- `server/src/modules/ci/generators/workflow.ts`
- `server/src/modules/ci/generators/slug.ts`
- `server/src/modules/ci/generators/bundle.ts`

**Concrete changes:**

- `slug.ts`: `kebabSlug(name)` + `dedupeSlugs(names)` → kebab-case with `-2/-3` collision suffix per bundle. No DB access.
- `manifest.ts`: `agentYaml(agent, skillSlugs): string` producing `.devdigest/agents/<slug>.yaml` conforming to `AgentManifest` (name, provider, model, system_prompt, skills, strategy, ci_fail_on). Secret NEVER embedded.
- `workflow.ts`: `workflowYml({ triggers, postAs, base }): string` producing a self-contained `.github/workflows/devdigest-review.yml` with the R39 invariants — `permissions: { contents: read, pull-requests: write }`, `on.pull_request.types` from `triggers`, secret only `${{ secrets.OPENROUTER_API_KEY }}`, no `pull_request_target`, step `node .devdigest/runner/index.js` (no `uses:` marketplace, no `npm install`).
- `bundle.ts`: `assembleFiles({...}): CiFile[]` — sets `editable=false` for manifest, skills/\*.md, memory.jsonl, runner/index.js; `editable=true` only for workflow.yml. Reads `agent-runner/dist/index.js` from disk (resolve path relative to repo root); on ENOENT throw a domain error whose message advises `pnpm --dir agent-runner build`. Includes `.devdigest/memory.jsonl` from whatever memory snapshot exists (possibly empty string — SPEC 3 owns population).

**Acceptance Criteria:**

- [ ] AC-008 (→ R4/AC-3): collision → `<name>` + `<name>-2`; no DB write.
- [ ] AC-009 (→ R5/AC-4): only workflow.yml has `editable=true`.
- [ ] AC-010 (→ R3/AC-2): missing dist → thrown error with build advice; present → file at `.devdigest/runner/index.js`.
- [ ] AC-011 (→ R39/AC-39/40/41): parsed workflow has exact permissions, secret-only-via-secrets, no `pull_request_target`, node-runner step.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-008..011 | Unit tests `server/src/modules/ci/generators/*.test.ts` (hermetic; use a temp fake `dist/index.js` for the present-path case). |

---

### TASK-005: `ci` module — repository + container wiring

**Scope:** backend. Depends on TASK-002 (schema), TASK-001 (contracts).

**Owned Paths:**

- `server/src/modules/ci/repository.ts`
- `server/src/platform/container.ts` (add `ciRepo` getter only)

**Concrete changes (repository.ts — the ONLY layer touching the DB for CI):**

- `upsertInstallation({ agentId, repo, targetType })` (conflict on (agent_id, repo)).
- `listInstallationsForAgent(agentId)` with latest-run subquery → repo, target_type, last_run_status, last_ran_at, active_count.
- `listInstallationsAll()` / `getInstallation(id)` for ingest; `updateSyncState(installationId, { etag, at })`.
- `upsertRun(row)` (conflict/idempotency key: (ci_installation_id, pr_number, github run id) — store github run id in `github_url` or dedupe on `github_url`).
- `insertRunFindings(ciRunId, findings)` into `ci_run_findings`.
- `listRuns(workspaceId, filters)` — server-side WHERE for `from/to/agent/repo/status/source`, LEFT JOIN `ci_installations` (repo, target_type) + agent name; aggregate findings into `CiRun.findings`.
- Container: add `get ciRepo(): CiRepository` (lazy, mirrors `evalsRepo`).

**Acceptance Criteria:**

- [ ] AC-012 (→ R18/AC-18): `listInstallationsForAgent` returns latest run status+ranAt; installation with no runs → null last-run → "No runs yet".
- [ ] AC-013 (→ R22/AC-21): `listRuns` filters applied in SQL.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-012/013 | Covered by TASK-007 `.it.test` against real PG. |

---

### TASK-006: `ci` module — export service + routes (export/installations)

**Scope:** backend. Depends on TASK-003, TASK-004, TASK-005.

**Owned Paths:**

- `server/src/modules/ci/service.ts` (export half — `CiService`)
- `server/src/modules/ci/routes.ts` (export/installations routes)

**Concrete changes:**

- `CiService` constructed with `container` (pattern: `new EvalsService(container)`). Uses `container.agentsRepo`, `container.skillsRepo`, `container.ciRepo`, `await container.github()`.
- `exportCi(workspaceId, agentId, input: CiExportInput)`:
  - read agent + linked skills; generate manifest + skills/\*.md (slug on the fly) + workflow.yml (from triggers/post_as/base) + memory.jsonl + runner bundle → `assembleFiles()`.
  - `action=open_pr`: `github.commitFiles(repo, { branch: 'devdigest/ci', base: input.base, message, files })` then reuse `findOpenPr`/`openPullRequest`; `ciRepo.upsertInstallation`; return `CiExport{installation, files, pr_url}`.
  - `action=files`: build a zip **server-side** (Node `zlib`/a lightweight zip lib already available server-side — NO JSZip) preserving paths incl. runner bundle; return the buffer; do NOT upsert an installation.
  - `updateCiConfig(workspaceId, agentId)`: re-run generation + `commitFiles` to ALL `ciRepo.listInstallationsForAgent` repos (upsert each). Silent.
- Routes (Fastify plugin, `withTypeProvider<ZodTypeProvider>()`, `getContext`, `IdParams`):
  - `POST /agents/:id/export-ci` (body `CiExportInput`) → `open_pr` returns `CiExport`; `files` sets `application/zip` + `content-disposition` and returns the buffer.
  - `GET /agents/:id/ci-installations` → `CiInstallationsResponse`.
  - "Update CI config" reuses `POST /agents/:id/export-ci` semantics OR a dedicated `POST /agents/:id/ci-installations/refresh-config`; recommend a distinct silent endpoint to avoid conflating with the wizard. Tight `config.rateLimit` on export (mirrors reviews).

**Acceptance Criteria:**

- [ ] AC-014 (→ R2/AC-1): open_pr upserts one installation + returns files + pr_url; `commitFiles`(branch `devdigest/ci`) + `openPullRequest` called.
- [ ] AC-015 (→ R6/AC-5): files → zip blob; no new installation; unzip preserves paths.
- [ ] AC-016 (→ R7/AC-6): agent with 2 installations → Update CI config commits to both; installations updated, not duplicated.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-014/015/016 | `server/src/modules/ci/ci.it.test.ts` (real PG, `MockGitHubClient` via `ContainerOverrides.github`). |

---

### TASK-007: `ci` module — ingest service + routes + register module

**Scope:** backend. Depends on TASK-003, TASK-005, TASK-006.

**Owned Paths:**

- `server/src/modules/ci/ingest.ts` (or `service.ts` ingest half — keep in the ci module, no overlap with TASK-006 file if split)
- `server/src/modules/ci/routes.ts` (ci-runs routes — **same file as TASK-006; sequence TASK-007 after TASK-006, do not parallelize the two**)
- `server/src/modules/index.ts` (one import + one `ci` entry in the `modules` record)

**Concrete changes:**

- `CiIngestService.ingestAll(workspaceId, { repo? })`:
  - for each installation: `github.listWorkflowRuns(repo, { etag: installation.last_synced_etag })`; `notModified` → no-op; else for each COMPLETED run: `downloadArtifact` → unzip → `CiResultArtifact.safeParse` (invalid → skip run, don't crash); fetch PR title; derive `CiRunStatus` per R33; `ciRepo.upsertRun` + create `agent_runs(source='ci')` (reuse `container.reviewRepo` run insert if suitable, else a ci-owned insert) + `ciRepo.insertRunFindings`; then `ciRepo.updateSyncState(etag, now)`.
  - `deriveStatus({ status, conclusion, artifactPresent, findingsCount })` pure helper (unit-tested): **failed ONLY when artifact absent** (gate-blocked run with artifact → succeeded).
- Routes:
  - `GET /ci-runs` (querystring `CiRunsQuery`) → `CiRunsResponse` (server-side filters via `ciRepo.listRuns`).
  - `POST /ci-runs/refresh` (optional `repo`) → `CiRefreshResult`; global across installations (mirrors `polling/routes.ts` manual-refresh precedent).
- Register: add `import ci from "./ci/routes.js";` + `ci,` to the `modules` record in `index.ts`.

**Acceptance Criteria:**

- [ ] AC-017 (→ R29/AC-28): 304 → no ci_runs change; 200 → new rows + updated etag.
- [ ] AC-018 (→ R30/AC-29): running+completed set → only completed ingested.
- [ ] AC-019 (→ R31/R32/AC-30/31/36): artifact → ci_runs row + agent_runs(source='ci') + ci_run_findings; `pr_title` from GitHub; critical/warning/suggestion/duration_ms mapped.
- [ ] AC-020 (→ R33/AC-32/33): status derivation table (4 cases) incl. gate-blocked+artifact → succeeded.
- [ ] AC-021 (→ R22/AC-21): `GET /ci-runs?status=failed` returns only failed; `?agent=X` scoped.
- [ ] AC-022 (→ R1/AC-7): `ci` present in `index.ts`; server boots; ci routes reachable.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-017/018/019/021 | `ci.it.test.ts` (real PG, mocked GitHub). |
| AC-020 | Unit `deriveStatus` table test (hermetic). |
| AC-022 | `grep` `index.ts`; boot smoke. |

---

### TASK-008: Client — API layer + hooks + nav

**Scope:** frontend. Depends on TASK-001 (contracts). Blocks TASK-009/010/011.

**Owned Paths:**

- `client/src/lib/api.ts` (add ci fetchers)
- `client/src/lib/hooks/ci.ts` (new)
- `client/src/vendor/ui/nav.ts`

**Concrete changes:**

- `api.ts`: `exportCi(agentId, body)`, `downloadCiZip(agentId, body)` (blob), `getCiInstallations(agentId)`, `getCiRuns(query)`, `refreshCiRuns(repo?)`, `updateCiConfig(agentId)` — all via `apiFetch`.
- `hooks/ci.ts`: TanStack Query hooks — `useCiInstallations(agentId)`, `useCiRuns(filters)` (with `refetchOnMount` for the refresh-on-entry model), `useRefreshCiRuns()` (mutation → invalidate `ci-runs`), `useExportCi()`, `useUpdateCiConfig()`. Query keys colocated here per the api.ts convention.
- `nav.ts`: add a `CI Runs` item to the SKILLS LAB group → `/ci` (choose an `IconName` from `./icons`, e.g. a workflow/rocket icon; gKey optional). Add matching `SHORTCUTS` entry if a gKey is chosen.

**Acceptance Criteria:**

- [ ] AC-023 (→ R21/AC-20): nav item under SKILLS LAB → `/ci`.
- [ ] AC-024 (→ R28/AC-27): `useCiRuns` uses `refetchOnMount`; no interval.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-023 | Render sidebar → CI Runs present, routes to /ci. |
| AC-024 | Hook config asserts `refetchOnMount: 'always'`, no `refetchInterval`. |

---

### TASK-009: Client — Export Wizard (4 steps)

**Scope:** frontend. Depends on TASK-008. Adds client deps.

**Owned Paths:**

- `client/src/app/agents/_components/ExportWizard/**` (new; final sub-path confirmed against current agents layout)
- `client/package.json` (add `@codemirror/lang-yaml` + CodeMirror 6 core + `yaml`)

**Concrete changes:**

- Modal wrapping `ExportWizardSteps` (`step` 0-based, `labels=["Target","Preview","Configure","Install"]`).
- Step 1 Target: 4 cards, only `gha` selectable; others DISABLED "Coming soon"; default `target="gha"`.
- Step 2 Preview: left selector of the 5 readable files + right content; runner bundle excluded from the list. `workflow.yml` → CodeMirror-6 editor (`@codemirror/lang-yaml`, line numbers, auto-indent); others read-only monospace. Validation: `yaml.parse()` throw → HARD-block Continue/Install + syntax error; structural lint (permissions/`pull_request_target`/hardcoded-secret/missing-runner-step) → SOFT warn (non-blocking, framed as assist).
- Step 3 Configure: trigger checkboxes (opened=on, synchronize=on, reopened=off) → `on.pull_request.types`; "Post results as" radio (3 static option blocks) + a dynamic hint block that changes per selection + static bottom merge-block hint.
- Step 4 Install: "Open a PR" (open_pr) vs "Copy files as a zip" (files) + help link `https://docs.github.com/en/actions`. Edits held in React state (Variant A, no Save); survive Back/Continue; committed only at Install; discarded on modal close.
- Entry points "Add to CI" and "+ Add repository" both open THIS wizard (wired in TASK-010's CI tab).

**Acceptance Criteria:**

- [ ] AC-025 (→ R8/9/10/11): 4 steps; only gha; 5 preview files; only workflow.yml editable.
- [ ] AC-026 (→ R12/13/14): invalid YAML hard-blocks; `pull_request_target` soft-warns; edit survives Back/Continue, gone on reopen.
- [ ] AC-027 (→ R15/16): dynamic post_as hint; open_pr vs zip delivery; help link.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-025/026/027 | Component tests (vitest + jsdom) + optional e2e; `client/package.json` shows codemirror + yaml, no monaco/jszip. |

---

### TASK-010: Client — Agent CI tab

**Scope:** frontend. Depends on TASK-008, TASK-009.

**Owned Paths:**

- `client/src/app/agents/[id]/**` (CI tab component + tab wiring; sub-path confirmed against current agent page)

**Concrete changes:**

- "Active in N repos" badge (`useCiInstallations` → active_count).
- Installation rows: repo + target_type + last-run STATUS + last `ran_at`; "No runs yet" when null.
- "Fail CI on" selector (Critical\|Warning+\|Never) → maps to `ci_fail_on` (critical\|warning\|never) via the existing agents-update path; no auto-push.
- Buttons: "Add to CI" + "+ Add repository" (open TASK-009 wizard) + "Update CI config" (silent `useUpdateCiConfig`); "Update CI config" DISABLED + tooltip "No repos yet — use Add to CI" when active_count===0.

**Acceptance Criteria:**

- [ ] AC-028 (→ R17/18): badge count; rows with status+ranAt / "No runs yet".
- [ ] AC-029 (→ R19/R20/AC-43): selector updates ci_fail_on; Update CI config disabled at 0 installations with tooltip.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-028/029 | Component tests with mocked hooks; e2e for disabled-button tooltip. |

---

### TASK-011: Client — CI Runs page (`/ci`)

**Scope:** frontend. Depends on TASK-008.

**Owned Paths:**

- `client/src/app/ci/**` (page, table, filters, trace drawer)

**Concrete changes:**

- Header "CI Runs" + subtitle "Agent reviews executed inside CI · not local runs" + `AutoTriggerStatus` (`detail="synced Xm ago"`, `on` reflects last sync) + manual Refresh (`useRefreshCiRuns`).
- Server-side filters (from/to via "Last 7 days" preset, agent, repo, status, source) → `useCiRuns(filters)`.
- Table columns: TIMESTAMP \| PULL REQUEST (#num + escaped `pr_title`) \| AGENT \| SOURCE \| DUR. \| FINDINGS (`SeverityChip` + `FindingsPopover`, findings sorted at render by severity→file:line) \| COST \| STATUS \| Trace.
- Trace: lightweight drawer (agent, PR#+title, source, status, duration, cost, severity breakdown, timestamp) + "View full logs on GitHub Actions" → `ci_runs.github_url`. Reuse `RunTraceDrawer` shell atoms where trivial; no prompt/tool/raw.
- Empty state "No CI runs yet" + explanation + CTA "+ Set up CI for an agent" → `/agents`.
- Ingest-on-entry: page mount triggers the single refresh (via the `refetchOnMount` hook / a mount effect calling `useRefreshCiRuns`), no interval.

**Acceptance Criteria:**

- [ ] AC-030 (→ R23/24/25): columns present; FINDINGS reuses SeverityChip+FindingsPopover; render-sort deterministic.
- [ ] AC-031 (→ R26/27/34): Trace drawer fields + githubUrl link; empty-state CTA → /agents; AutoTriggerStatus shows "synced…", not "polling".
- [ ] AC-032 (→ R41): `pr_title` escaped at render.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-030 | Unit render-sort test; component test for columns/popover. |
| AC-031 | Component/e2e for drawer + empty state + AutoTriggerStatus copy. |

---

## Implementation Phases

> ⚙️ Execution mode: **multi-agent**. Phase 0 (TASK-001, TASK-002) runs FIRST (shared prerequisites). Then two tracks run in parallel with **disjoint owned paths**: **Backend** (`server/**`, `drizzle/**`) and **Frontend** (`client/**`). Within each track, tasks are sequential.

### Phase 0: Shared prerequisites (blocks both tracks)

- [ ] TASK-001 — contracts (both `eval-ci.ts` mirrors).
- [ ] TASK-002 — schema + migrations (`ci_runs`, `ci_installations` ETag, `ci_run_findings`); `pnpm db:generate` ×2 + `pnpm db:migrate`.

### Backend track (∥ Frontend track after Phase 0)

- [ ] TASK-003 — GitHubClient port + Octokit + mock.
- [ ] TASK-004 — generators (manifest / workflow / slug / bundle).
- [ ] TASK-005 — repository + `ciRepo` container getter.
- [ ] TASK-006 — export service + export/installations routes.
- [ ] TASK-007 — ingest service + ci-runs routes + register in `index.ts`. _(shares `routes.ts` with TASK-006 → runs after it, NOT in parallel.)_

### Frontend track (∥ Backend track after Phase 0)

- [ ] TASK-008 — api.ts + hooks + nav.ts.
- [ ] TASK-009 — Export Wizard (+ CodeMirror/yaml deps).
- [ ] TASK-010 — Agent CI tab.
- [ ] TASK-011 — CI Runs page.

### Phase Tests (both tracks)

- [ ] Backend hermetic unit: `generators/*.test.ts`, `deriveStatus` table.
- [ ] Backend integration `ci.it.test.ts` (real PG, `MockGitHubClient`): export open_pr / files / update-config; ingest 304/200, completed-only, artifact→rows+findings, filters.
- [ ] Frontend: component tests (jsdom) for wizard validation, CI tab disabled-button, CI Runs render-sort + columns.

---

## Self-verification checklist

- [ ] `cd server && pnpm typecheck` — green.
- [ ] `cd client && pnpm typecheck` — green.
- [ ] `diff` the CI blocks of both `eval-ci.ts` mirrors → identical (AC-38).
- [ ] `cd server && pnpm db:generate` (×2) + `pnpm db:migrate` — two separate migration files apply cleanly; `ci_runs` has 5 new cols (no `verdict`), `ci_installations` has ETag cols, `ci_run_findings` exists.
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — hermetic units (generators, deriveStatus) pass.
- [ ] `cd server && pnpm exec vitest run .it.test` — export + ingest integration (real PG, GitHub mocked) pass.
- [ ] `cd client && pnpm test` — wizard/CI-tab/CI-Runs component tests pass.
- [ ] `grep` `server/src/modules/index.ts` shows the `ci` entry; server boots and ci routes respond.
- [ ] `client/package.json` shows CodeMirror 6 + `yaml`; NO `monaco`, NO `jszip`.
- [ ] Generated `workflow.yml` (unit-parsed): permissions exactly `{contents:read, pull-requests:write}`; secret only `${{ secrets.OPENROUTER_API_KEY }}`; no `pull_request_target`; `node .devdigest/runner/index.js` step.
- [ ] No changes under `reviews/` core, multi-agent-review, or PR feed.

## Test split

- **Hermetic `*.test.ts`** (no PG): all generators (`manifest`/`workflow`/`slug`/`bundle` with a temp fake `dist/index.js`), `deriveStatus` status-derivation table, client component tests.
- **Integration `*.it.test.ts`** (real PG via testcontainers, GitHub via `MockGitHubClient` through `ContainerOverrides.github`): `export-ci` open_pr/files/update-config, ingest 304-no-op / 200-ingest / completed-only / artifact→ci_runs+agent_runs(source='ci')+ci_run_findings / server-side filters / etag update.

## Risks & Mitigations

| Risk                                                         | Mitigation                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-1: findings→agent_run linkage vs `findings.review_id` FK | Default to additive `ci_run_findings` table (ci-owned, FK to `ci_runs`); reviews core untouched; confirm with user if a synthetic review row is preferred instead.  |
| `agent-runner/dist/index.js` gitignored / absent at export   | Read-from-disk with explicit build-advice error (AC-2); document `pnpm --dir agent-runner build` as a pre-req; do not `child_process`-build.                        |
| Server-side zip without JSZip                                | Use Node's built-in `zlib` or an already-present server zip util; verify no new client dep; unzip test asserts path preservation.                                   |
| ETag semantics per installation vs per-workflow-run dedupe   | Store `last_synced_etag` on the installation; also dedupe runs on the GitHub run id (in `github_url`) so a stale/absent etag can't double-insert.                   |
| CodeMirror 6 SSR in Next.js App Router                       | Editor is a Client Component (`"use client"`), lazy/dynamic import to avoid SSR window access.                                                                      |
| Agents page sub-path assumptions (`[id]`, `_components`)     | Frontend implementer confirms actual `client/src/app/agents/` layout before creating files; owned path is the whole `agents/` + `ci/` subtree (no backend overlap). |
| Two migrations ordering (AC-42 separate file)                | Generate in two `db:generate` passes so the ETag columns land in their own migration file.                                                                          |
| Untrusted `pr_title` / artifact                              | Escape `pr_title` at render (AC render); `CiResultArtifact.safeParse` before any write; invalid artifact → skip the run, never throw.                               |

## Out of Scope

- `verdict` field anywhere (contract/DB/UI) — CI Runs = STATUS + FINDINGS (Q11).
- Memory subsystem (SPEC 3) — this PR only SHIPS `.devdigest/memory.jsonl` in the bundle (from whatever memory exists, possibly empty).
- `reviews/` core, multi-agent-review, PR feed / multi-run service.
- CircleCI / Jenkins / Generic CLI (DISABLED "Coming soon").
- Webhook / cron / background poller; ingest of running/in-progress runs; full RunTrace parity for CI.
- Columns `workflow_version`, `suspended_at`; live CI retrieval; per-agent memory.

## Architecture Notes

- **Onion / module pattern:** `ci` module = `routes.ts` (Fastify plugin, `withTypeProvider<ZodTypeProvider>()`, `getContext`, `IdParams`) → `service.ts`/`ingest.ts` (orchestration, `new CiService(container)`) → `repository.ts` (ONLY DB layer). All external I/O behind ports: DB via `container.ciRepo`, GitHub via `await container.github()`, disk read of the runner bundle in the generators layer.
- **DI:** add `ciRepo` getter to `container.ts` mirroring `evalsRepo`; no other container change (GitHub client already resolved via `container.github()`).
- **Contracts single source:** `eval-ci.ts` server mirror is authored first, copied byte-identically to the client mirror (AC-38). `Finding` reused from `contracts/findings` (already imported in `eval-ci.ts`).
- **Findings read path (GAP-1 default):** `GET /ci-runs` joins `ci_run_findings` into `CiRun.findings`; the CI Runs FINDINGS column + `FindingsPopover` render from that DTO. `agent_runs(source='ci')` is created for local-run parity/observability but is not the findings read path.
- **Security invariants live in the generator, not the editor:** `workflow.ts` emits a workflow that already satisfies R39; the client security-lint is a soft-warn assist over user edits, and the Phase-2 human PR review is the final gate.
- **No background load:** ingest is strictly on `/ci` mount + manual Refresh (`refetchOnMount`, `POST /ci-runs/refresh`), following the `polling/routes.ts` manual-refresh precedent; ETag/`If-None-Match` keeps 304s off the rate limit.
