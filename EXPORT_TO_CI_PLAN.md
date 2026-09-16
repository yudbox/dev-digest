# Export to CI + Memory Subsystem — Consolidated Plan (source for 3 specs)

> This document is the agreed design, produced through a long interactive planning session.
> It is the SINGLE SOURCE OF TRUTH for three separate specs (spec-creator reads it):
> **SPEC 1 — agent-runner**, **SPEC 2 — Export to CI**, **SPEC 3 — Memory subsystem**.
> 3 specs → 3 plans → 3 implementations → 3 PRs, strictly in order (each depends on the previous).

---

## Global context

DevDigest is a studio for configuring review agents (model + system prompt + linked skills + settings) that
currently run only locally (`agent_runs.source = 'local'`). This work makes agents deployable to a target repo's
**GitHub Actions** so they auto-review every PR with the SAME `reviewer-core` engine as local runs (grounding gate +
deterministic verdict), and adds a **Memory subsystem** that lets agents learn from dismissed findings.

Studio is a LOCAL tool (secrets in `~/.devdigest/secrets.json`; no public URL; GitHub cannot reach it).

### Already exists (verified in code)

- Contracts `server/src/vendor/shared/contracts/eval-ci.ts` (+ client vendor mirror): `CiTarget`, `CiFile`,
  `CiExportInput`, `CiExport`, `CiInstallation`, `CiRun`, `CiRunStatus`, `CiResultArtifact`, `AgentManifest`.
- DB `server/src/db/schema/ci.ts`: `ci_installations`, `ci_runs`. `agent_runs.source` `'local'|'ci'` exists.
- `agent-runner/` fully implemented (9 modules): reads `.devdigest/agents/<slug>.yaml` + `skills/<slug>.md`,
  calls the same `reviewPullRequest` from `reviewer-core`, computes deterministic verdict via
  `toReviewPayload`/`countBlockers`/`gateTriggered`, writes `devdigest-result.json`, posts GitHub review/comment,
  exits non-zero on REQUEST_CHANGES. Built via `pnpm --dir agent-runner build` (ncc) → `dist/index.js`
  (gitignored). `manifest.ts` enforces EXACTLY ONE agent manifest per `.devdigest/` deployment.
- GitHubClient port (`vendor/shared/adapters.ts`) has `commitFiles` (atomic multi-file, reuse-branch) + `findOpenPr`.
  MISSING: list workflow runs + download artifact.
- `memory` table (`server/src/db/schema/knowledge.ts`): workspaceId, repoId, scope (repo|global|team),
  kind (decision|convention|preference|fact|learning), content, embedding vector(1536), confidence, sources jsonb,
  createdAt, updatedAt, lastUsedAt. NO agentId. Currently UNUSED — `run-executor.ts` stubs `memory: null`.
- `reviewer-core` ALREADY accepts `memory?: string[]` → injects prompt block "## Relevant memory".
- Finding accept/dismiss EXISTS in reviews module (`reviews/routes.ts` POST /findings/:id/accept|dismiss,
  `reviews.ts` acceptedAt/dismissedAt).
- Feature Models system: `FeatureModelId` enum (`contracts/platform.ts` + client mirror `lib/utils/featureModels.ts`),
  `FEATURE_MODELS` registry, `resolveFeatureModelStrict(container, wsId, featureId)`
  (`server/src/modules/settings/feature-models.ts`, 422 if unconfigured), Settings → Feature Models UI auto-renders.
- UI vendor: `client/src/vendor/ui/ExportWizardSteps.tsx` (props step 0-based + labels[]), `AutoTriggerStatus.tsx`
  (pulsing green dot + on + detail), `nav.ts` (NAV groups + SHORTCUTS). Reusable: `client/src/components/SeverityChip`
  (icon + 12-slot dots), `pulls/_components/FindingsPopover` (hover finding details), `RunTraceDrawer` (rich trace).
- Precedent for MANUAL refresh (no cron): `server/src/modules/polling/routes.ts`.

### Cross-cutting rules

- Not a monorepo: each package installs its own deps (pnpm). reviewer-core & agent-runner consumed as raw TS via
  path aliases.
- IGNORE the upstream reference impl (another student) entirely — self-authored.
- Migrations explicit only (`pnpm db:generate` then `pnpm db:migrate`).

---

# SPEC 1 — agent-runner (thin; PR 1, merges FIRST)

Rationale for separate first PR (course advice): the runner's huge ncc bundle diff shouldn't bloat later PRs' review.

**Scope:** the only functional change to the already-complete agent-runner is to EMIT the individual findings in
the result artifact, so the studio can ingest full finding details for CI runs (parity with local runs).

- Extend `CiResultArtifact` contract with `findings: Finding[]` (reuse existing `Finding` type). Keep existing
  fields (findings_count, critical, warning, suggestion, cost_usd, duration_ms, agent, version, pr_number).
- `agent-runner/src/artifact.ts` `buildResultArtifact`: include `outcome.review.findings` (runner already has them —
  it posts them to GitHub). Validate against the same `CiResultArtifact` Zod schema.
- `agent-runner/src/run.ts`: pass findings into the artifact build.
- No verdict field is added anywhere (see SPEC 2 Q11): CI Runs uses STATUS + FINDINGS, not a verdict column.
- Prep: `dist/index.js` is produced by `pnpm --dir agent-runner build` (pre-built, read from disk by SPEC 2's export).
- Tests: `run.test.ts` asserts `artifact.findings` present and shaped.

Dependency: SPEC 2's ingest consumes these findings.

---

# SPEC 2 — Export to CI (PR 2)

Deploy a configured agent to a target repo's GitHub Actions via an Export Wizard, view CI runs, manage per-repo
installations. Ingest is pull-based.

## Scope / boundaries

- OWN: `server/src/modules/ci/`, client `/ci` page (CI Runs), agent CI tab, Export Wizard, `nav.ts` "CI Runs",
  GitHubClient port additions (listWorkflowRuns / downloadArtifact), `ci_runs` migration.
- DO NOT TOUCH: `reviews/` core logic, multi-agent-review, PR feed / multi-run service.

## Resolved decisions

- **Q1 slug:** compute on the fly (kebab-case from agent/skill name, `-2/-3` suffix on collision). No DB column.
  It's a generated build artifact, regenerated each export, not a public stable id.
- **Q2 runner bundle:** server reads pre-built `agent-runner/dist/index.js` from disk at export time; clear error if
  missing ("run pnpm --dir agent-runner build first"). No child_process build in the HTTP handler. CI-run-time: NO
  npm install / NO marketplace action — `node .devdigest/runner/index.js` runs the bundled file directly
  (lethal-trifecta / supply-chain avoidance).
- **Q4 ingest transport:** PULL/poll (no webhook). Workflow adds `actions/upload-artifact@v4` with
  `devdigest-result.json`. Studio pulls via GitHubClient/token.
- **Q11 verdict vs STATUS:** follow the N13 design — CI Runs shows STATUS + FINDINGS, NO verdict column. No verdict
  in contracts/DB, no agent-runner verdict change. Blocker signal = STATUS(Failed) + FINDINGS(critical count).

## Export Wizard (4-step stepper, uses `ExportWizardSteps`)

Entry points: "Add to CI" (top-right) and "+ Add repository" (bottom of installations list) BOTH open the SAME
wizard + same `POST /agents/:id/export-ci` + create a ci_installation. "Update CI config" (top-right) is the SAME
server operation but silent (no wizard) — re-export to ALL existing installations of the agent (upsert by
(agent_id, repo)).

- **Step 1 Target:** 4 cards (GitHub Actions recommended | CircleCI | Jenkins | Generic CLI). Only GitHub Actions is
  selectable/functional; the other 3 are shown DISABLED with "Coming soon". `CiTarget` enum already has all 4;
  `target` defaults `"gha"`.
- **Step 2 Preview:** left = FILES TO CREATE list (selector); right = selected file content. 5 readable files:
  `.devdigest/agents/<slug>.yaml` (manifest), `.devdigest/skills/<slug>.md` (one per linked skill),
  `.devdigest/memory.jsonl` (from Memory — see SPEC 3; empty until memory exists),
  `.github/workflows/devdigest-review.yml`. The runner bundle `.devdigest/runner/index.js` IS committed to the PR
  but NOT shown in preview (huge minified file; diff.ts strips `.devdigest/**` from review).
  - Editability: ONLY `workflow.yml` is editable (`editable` badge). Export service sets `CiFile.editable=false`
    for derived files (contract defaults true → override). Placeholder `uses: devdigest/review-action@v1` is
    editable — real workflow is self-contained calling the bundled runner.
  - **Editor = Variant B (full code editor):** non-editable files → read-only monospace display; workflow.yml →
    real code editor with YAML syntax highlighting + auto-indent + line numbers. Client has NO editor/yaml lib →
    add deps: CodeMirror 6 (`@codemirror/lang-yaml`, lightweight — NOT Monaco) + `yaml` (for validation).
    Validation: (a) YAML syntax via yaml.parse() = hard-block Continue/Install; (b) structural security lints
    (permissions.contents==='read' AND pull-requests==='write' and nothing broader; NO pull_request_target;
    secret via ${{ secrets.* }} not hardcoded; a runner-invocation step exists) = soft-warn (Phase-2 human review
    still owns the final call; frame lints as an assist not a replacement).
  - **Save model = Variant A:** NO Save button. Edits auto-held in wizard React-state as you type; preserved across
    Back/Continue; committed to the PR only at Install (`CiFile[].contents`). Closing the modal before Install
    DISCARDS edits (no draft persistence).
- **Step 3 Configure:**
  - Triggers (checkboxes → workflow `on.pull_request.types`): opened (default on), synchronize (default on;
    important — re-review after new pushes), reopened (optional/off). Trigger decides WHEN, not what appears.
  - Post results as (radio → `post_as` → runner run.ts branch): `github_review` (recommended; postGithubReview;
    verdict APPROVE/REQUEST_CHANGES/COMMENT — ONLY mode with a verdict / can block merges) | `pr_comment`
    (postPrComment; plain comment; no verdict; won't block) | `none` (posts nothing; exit-code/check only).
    What appears in the PR depends on post_as; the check status (green/red) ALWAYS appears (exit code).
    UI copy: each of the 3 options has its OWN static label+description PLUS a DYNAMIC hint block below the radios
    whose text changes per selection (explains consequence + merge-block implication).
  - Bottom info hint: "To block merges: set Fail CI on (CI tab) → run exits non-zero, then add a required status
    check in GitHub branch protection. No GitHub App needed." Three levers: post_as (how shown) + Fail CI on (when
    fails) + branch protection (turns red check into a real merge lock, done by human in GitHub).
- **Step 4 Install:** two delivery options.
  - "Open a PR with these files" (action=open_pr, recommended): server generates `CiFile[]`, atomic commit to
    branch `devdigest/ci` + openPR; INSERT ci_installation. Needs studio write token.
  - "Copy files as a zip" (action=files, degraded): server generates the SAME files, packages into a zip
    SERVER-side (blob download; NOT client-side, no JSZip) preserving paths (.devdigest/**, .github/workflows/**),
    incl. the runner bundle. User deploys manually: unzip into repo root → branch devdigest/ci → commit/push →
    open PR themselves (or GitHub web Upload files → new branch + PR). Same files, same Phase-2 review; only the
    delivery differs. ci_installation is NOT created on zip export (Variant B) — it appears only when the first
    real run arrives via Refresh (honest; no confirmation possible).
  - Help link at bottom: "Need help? See the GitHub Action setup docs →" → real GitHub Actions docs
    (https://docs.github.com/en/actions ; secrets: /security-guides/using-secrets-in-github-actions).

## Export server operation (`POST /agents/:id/export-ci`)

Read agent + linked skills from DB → generate manifest YAML → generate skills/\*.md (slug on the fly, Q1) →
read `dist/index.js` from disk (Q2) → generate self-contained `workflow.yml` → include memory.jsonl (SPEC 3 export)
→ assemble `CiFile[]` → commitFiles to `devdigest/ci` + openPR (or return files for zip) → upsert ci_installation.

## workflow.yml (self-contained; exact content = implementer detail)

Key invariants (for the Phase-2 human security review): `permissions:` only `contents: read` +
`pull-requests: write`; secret only `${{ secrets.OPENROUTER_API_KEY }}` (not in code/manifest); fork-PRs get NO
secret (no `pull_request_target`); PR text is untrusted (no action triggers from comments); triggers from Step 3;
step `node .devdigest/runner/index.js` (no marketplace action).

## CI tab (agent page)

- "Active in N repos" badge = COUNT(ci_installations) for the agent (Q6 — state count; no "ran in last 30d";
  no suspended_at in v1).
- Installation rows: repo (ci_installations.repo) + target_type + last ci_run STATUS (integration health, matches
  design "succeeded") + last ci_run.ran_at (join/subquery latest run per installation). Before any run: "No runs yet".
  "workflow version" per row (Q9): v1 shows installed_at / last-export date (no version column).
- "Fail CI on" selector (Critical | Warning+ | Never): UI over EXISTING `AgentManifest.ci_fail_on`
  (enum never|critical|warning|any). Ranks SUGGESTION=1 WARNING=2 CRITICAL=3; blocks if rank ≥ threshold
  (reviewer-core FAIL_ON_MIN_RANK). Critical=only CRITICAL blocks; Warning+=CRITICAL+WARNING; Never=never blocks
  (enum `any` exists but design shows 3 tabs). Verdict computed deterministically by the runner, not the model.
  Apply timing = Variant A: selector updates ci_fail_on on the agent (DB); reaches CI only on the next explicit
  "Update CI config" re-export. No silent auto-push on tab change. Real merge-block still needs GitHub branch protection.
- Buttons: Add to CI / + Add repository (wizard) + Update CI config (silent re-export).

## CI Runs page (`/ci`, nav item under SKILLS LAB)

Header "CI Runs" + subtitle "Agent reviews executed inside CI · not local runs" + AutoTriggerStatus indicator +
manual Refresh button. Filters (server-side query params on GET /ci-runs): Last 7 days (date range) | All agents
(join→agent) | All repos (ci_installation.repo) | All statuses (ci_runs.status) | All sources (target_type).
Table columns: TIMESTAMP (ranAt) | PULL REQUEST (#num + title) | AGENT (join) | SOURCE (target_type via join) |
DUR. | FINDINGS (SeverityChip icons + 12-slot dots) | COST | STATUS | Trace.
Empty state: "No CI runs yet" + "Once you export an agent to CI, every automated review shows up here." +
"+ Set up CI for an agent" → navigates to `/agents` (Q10b; wizard is agent-scoped, no agent known here).

- **Findings column (Q24, full parity):** reuse `SeverityChip` (counts → icons + dots) AND `FindingsPopover`
  (hover → per-finding details: title, category, file:line, confidence, rationale). Requires ingesting individual
  findings (SPEC 1 emits `findings` in the artifact; ingest stores them linked to agent_run(source='ci')).
- **Trace link (Q22, hybrid):** clicking Trace opens a LIGHTWEIGHT drawer showing only what we have (agent, PR #+
  title, source, status, duration, cost, findings severity breakdown, timestamp) + a prominent "View full logs on
  GitHub Actions" button → ci_runs.githubUrl. Reuse RunTraceDrawer shell atoms where trivial; NO prompt assembly /
  tool calls / raw output (not available). No agent-runner change beyond findings; no full RunTrace ingest.

## Ingest (Refresh)

- **Auto-refresh model (Q26): fetch-on-page-entry** — a SINGLE ingest request on `/ci` mount (TanStack
  refetchOnMount). NO recurring interval, NO background poller. If user never visits /ci → ZERO auto requests.
- ETag / If-None-Match conditional request per ci_installation: GitHub 304 Not Modified (cheap, doesn't count
  against rate limit) → do nothing; 200 → ingest. Store ETag (or last-seen run id) per installation.
- Manual Refresh button = on-demand ingest while on the page.
- AutoTriggerStatus indicator shows LAST-SYNCED time ("synced 2m ago"), not "polling".
- WHY not compare local timestamps: CI runs are triggered by EXTERNAL GitHub PR events, not local runs; local runs
  don't show on CI Runs. GitHub is the source of truth → ETag.
- Mechanics: listWorkflowRuns (must return status + conclusion) per ci_installation repo → download
  `devdigest-result.json` → `CiResultArtifact.safeParse` → upsert ci_runs + create agent_runs(source='ci') + store
  findings. Fetch PR title from GitHub during Refresh. v1 ingests only COMPLETED runs (skip in-progress/running).
- **STATUS derivation (Q23):** status is NOT in the artifact — derived from (a) workflow-run status+conclusion and
  (b) artifact presence/content: in_progress/queued → running; completed + NO artifact + conclusion=failure →
  failed (runner broke); completed + artifact + findings_count>0 → succeeded; completed + artifact +
  findings_count===0 → no_findings. CRITICAL: failed ONLY when artifact ABSENT — a gate-blocked run
  (REQUEST_CHANGES → exit 1 → red job) still HAS an artifact → succeeded (with blockers), NOT failed.

## ci_runs migration (Q21)

Add columns: `pr_title`, `duration_ms`, `critical`, `warning`, `suggestion`. Agent + source shown via join
(no columns). Ingest maps CiResultArtifact fields → these columns; also stores individual findings (SPEC 1).

## GitHubClient port additions

`listWorkflowRuns(repo, ...)` (returns runs with status + conclusion + artifact refs + ETag) and
`downloadArtifact(...)` (+ Octokit adapter + mock). Support conditional requests (ETag).

## Verification

- Unit: manifest/workflow generators (pure fn); slug kebab + collision.
- Integration (.it.test.ts real PG, GitHub mocked): export-ci inserts ci_installation + returns files; ingest
  upserts ci_runs + agent_runs(source='ci') + findings from a CiResultArtifact.
- Typecheck all; db:generate + db:migrate.
- Manual acceptance (demo fork): wizard → PR → merge → test PR gets comments → CRITICAL blocks → run in CI Runs.

---

# SPEC 3 — Memory subsystem (PR 3, merges last)

A SHARED (workspace/repo/global) knowledge base that agents use to review better and learn from dismissed findings.
Everything studio-side; the CI runner only READS a memory snapshot.

## Scope decisions

- **Scope (Q17):** memory stays PURELY SHARED — NO agentId, no hybrid, no agent-scoped memory. It is
  project/repo/team knowledge used by all agents.
- **UI (Q17):** ONE global "Memory" page (sidebar). NO per-agent Memory tab. The page does NOT exist yet — build it.
- **Boundary (relaxed for this feature, Q15/Q28):** the learning loop reads finding accept/dismiss from the reviews
  module READ-ONLY (query the shared DB) — do NOT modify reviews core logic.

## Read path

- **Local reviews:** un-stub `run-executor.ts` (`memory: null` → real memory) so memory influences local reviews.
- **CI:** export a memory SNAPSHOT into `.devdigest/memory.jsonl` (runner has no DB). Runner adds `loadMemory()`
  (mirror loadSkillBodies), reads the file, passes `memory: string[]` to `reviewPullRequest` (engine already
  injects it). One agent per deployment → one memory.jsonl. Content = project/repo memory, not agent-identity.
  NOTE: this runner change could also live in SPEC 1/PR1 if convenient; otherwise here.
- **CI retrieval / snapshot size (Q29):** curated CAP of MAX 50 records into memory.jsonl, selected by confidence
  × recency (lastUsedAt), scope global + target repo. Embeddings NOT shipped (only content + metadata); ranking
  studio-side at export. Applied on export + Update CI config. (Rationale: only real constraint is prompt tokens —
  ~30-40 tokens/item; storage/RAM negligible. Cap keeps prompts cheap regardless of table growth.)

## Write paths

- **Explicit (+ Add memory):** human authors an item (form: content + kind + scope) → status=approved,
  source=explicit, ACTIVE immediately (proactive; no LLM; no pending).
- **Auto-learning (minimal, cheap):** background aggregation reads dismisses (Q28 read-only), groups by pattern;
  when ≥3-5 similar dismisses accumulate, an LLM DISTILLS them into ONE generalized rule (Q27). Use a CHEAP small
  model via a configurable Feature Model (Q31 `memory_distill`, default e.g. deepseek flash) — NOT the review model.
  Runs in background, batched, infrequent (~cents/month). Approval = POST-HOC (Q27): auto-add with LOW confidence,
  source=auto, visible on the Memory page, user DELETES bad ones (NOT a pending gate — minimal friction; safe
  because the dismiss signal is TRUSTED, done by the studio user, not untrusted PR authors). Confidence scales with
  dismiss count (3→~0.6, 5→~0.75).

## Governance (Q30, minimal in v1)

- ✅ Confidence threshold (~0.7) for prompt inclusion — weak memories don't reach reviews (nearly free WHERE clause;
  reconcile with auto-add low-confidence — they rise above threshold with more dismisses).
- ✅ Provenance: store source (explicit|auto) + `sources` jsonb (already in schema) — "added by you" vs "learned
  from N dismisses on #PR".
- ✅ Post-hoc delete on the Memory page (main anti-bad-memory lever).
- ⏸ DEFERRED (v2): decay, full audit-log, dedup (would need embeddings), embeddings generation.
- Anti-poisoning in v1 = trusted signal + post-hoc delete + confidence threshold. No pending-approval gate.
- Schema additions needed: `status` (or reuse), `source` (explicit|auto) fields on the `memory` table.

## Memory page design (proposed & approved, Q18/Q18b)

Studio-local data only (NOT GitHub). Layout (CI-Runs style):

- Header: "Memory" + subtitle "What your agents have learned about this codebase" + [+ Add memory] + [Refresh]
  (manual, re-reads LOCAL DB to surface new auto-learned rows; does NOT hit GitHub).
- Filters: scope (global/repo/team) | kind | source (explicit/auto) | text search.
- Active memory table: CONTENT | KIND | SCOPE (show repo name for repo-scoped, e.g. "repo · acme/payments-api";
  global shows "global") | SOURCE (explicit/auto) | CONF | USED (= lastUsedAt "2d ago"; updated by LOCAL reviews;
  CI usage not counted) | ⋯ (Edit / Delete / view provenance).
- Empty state: "No memories yet" + explanation + [+ Add memory].

## Feature Model for distillation (Q31)

Add `"memory_distill"` to `FeatureModelId` enum (server + client mirror); add FEATURE_MODELS entry
{id:"memory_distill", label:"Memory · Learning", description:"Distills dismissed findings into memory rules.",
defaultProvider:"openrouter", defaultModel: a cheap model e.g. "deepseek/deepseek-v4-flash"}. Distillation calls
`resolveFeatureModelStrict(container, wsId, "memory_distill")`. Settings → Feature Models auto-renders the picker.

## Verification

- Unit: distillation prompt/aggregation (LLM stubbed); curated top-50 selection; confidence threshold filter.
- Integration (.it.test.ts real PG): explicit add → active; background aggregation of ≥3 dismisses → auto memory
  (LLM stubbed) with source=auto low confidence; export snapshot ≤50 by confidence×recency; run-executor pulls
  memory into local review.
- Typecheck; migrations for the new memory fields.

---

## SPEC 2 clarifications — RESOLVED

1. ETag / last-seen-run storage → columns on `ci_installations` (`last_synced_etag` text, `last_synced_at`
   timestamp); per-installation state, NOT in the ci_runs migration.
2. `GET /ci-runs` filters → `from`/`to` (ISO datetimes) for the range + `agent`, `repo`, `status`, `source`
   (=target_type). UI computes from/to from the "Last 7 days" preset.
3. Edge (completed + artifact absent + conclusion=success) → treat as `failed` in v1 (no artifact = no ingestable
   result; anomalous config).
4. Ingest endpoint → `POST /ci-runs/refresh`, GLOBAL (all installations); may accept an optional repo filter for
   the agent CI tab.
5. "Update CI config" with zero installations → DISABLE the button + tooltip "No repos yet — use Add to CI"
   (not a silent no-op).

## SPEC 3 clarifications — RESOLVED

1. Auto-learning aggregation trigger → runs ON-DEMAND when the Memory page loads / manual Refresh (studio-side).
   No cron.
2. Grouping key for "similar" dismisses (no embeddings) → group by (finding category + file path pattern, e.g.
   directory-level).
3. Idempotency (reviews is read-only) → memory module keeps its OWN watermark (last_processed_at); read dismisses
   with dismissedAt > watermark, then advance it. Never write to reviews.
4. Default explicit confidence → 0.9 (trusted human author; clears the 0.7 gate).
5. Auto confidence curve → confidence = min(0.45 + 0.06 × dismiss_count, 0.9) → 3≈0.63, 5≈0.75, cap 0.9
   (needs ~5 dismisses to reach the prompt — acceptable).
6. `status` field → NOT needed (post-hoc = active immediately). Use `source` + confidence + 0.7 threshold. No status field.
7. `team` scope in the v1 add-form → NO; form offers global + repo only. team stays in the enum for the future.
8. `lastUsedAt = null` in recency ranking → COALESCE(lastUsedAt, createdAt).
9. `loadMemory` malformed JSONL → skip bad lines (do not crash); memory is auxiliary, one bad line must not fail the review.
10. Runner `loadMemory` placement → PR1 (agent-runner), keeping all runner changes together (merged first);
    loadMemory tolerates empty/missing file so it is safe before memory.jsonl has content.
    Note: client featureModels.ts mirror currently lacks the `eval` entry — ensure `memory_distill` is added to BOTH
    the server enum/registry and the client mirror (AC-31).

## Deferred (v2, out of scope for these 3 PRs)

memory decay, full audit-log, dedup (embeddings), embeddings generation, workflow_version column, suspended_at,
CircleCI/Jenkins/CLI targets, running-status ingest, verdict column, per-agent memory, live CI retrieval, full
RunTrace parity for CI.
