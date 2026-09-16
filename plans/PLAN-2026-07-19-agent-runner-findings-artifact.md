# Plan: agent-runner emits findings in result artifact

> Status: DRAFT
> Created: 2026-07-19
> Spec: agent-runner/specs/SPEC-2026-07-19-agent-runner-findings-artifact.md
> Source context: EXPORT_TO_CI_PLAN.md (Global context + "SPEC 1 — agent-runner")
> Execution Mode: single-agent (small, tightly-coupled change across contract + artifact builder + tests; shared files, no parallelizable owned-path split)
> PR ordering: PR 1 of 3 (agent-runner → Export to CI → Memory). Merges FIRST.

## Requirements (VRF)

> Status: Confirmed (VRF passed — no gaps; scope is mechanical and fully specified)

| ID  | Requirement                                                                                                                                                                                                                               | Source    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| R1  | Extend `CiResultArtifact` with a required `findings: Finding[]` field, reusing the existing `Finding` from `contracts/findings`, in BOTH mirrors (`server/…/eval-ci.ts` + `client/…/eval-ci.ts`), keeping every existing field unchanged. | SPEC AC-1 |
| R2  | Both `eval-ci.ts` mirrors stay identical in the `CiResultArtifact` shape.                                                                                                                                                                 | SPEC AC-2 |
| R3  | `buildResultArtifact` includes `findings` in the candidate object, equal to `input.findings`, and validates against the same `CiResultArtifact` Zod schema.                                                                               | SPEC AC-3 |
| R4  | A candidate that fails `CiResultArtifact.safeParse` throws `RunnerError` (existing behavior extends to the new field).                                                                                                                    | SPEC AC-4 |
| R5  | Invariant `artifact.findings.length === artifact.findings_count` holds for every run.                                                                                                                                                     | SPEC AC-5 |
| R6  | `runCi` passes `outcome.review.findings` (grounded, post-`reviewPullRequest`) into `buildResultArtifact`.                                                                                                                                 | SPEC AC-6 |
| R7  | Hard-fail path is unchanged: no artifact written, returns `{ exitCode: 1, artifact: null }`.                                                                                                                                              | SPEC AC-7 |
| R8  | The written `devdigest-result.json` passes `CiResultArtifact.safeParse` with a well-shaped `findings` array.                                                                                                                              | SPEC AC-8 |

## Open Questions & Recommendations

| #   | Question                                                              | Answer                                                                                                                                                                             | Type                      |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Q1  | Does `run.ts` need a change to pass findings?                         | **No.** `run.ts` already calls `buildResultArtifact({ findings: outcome.review.findings, … })` (used today for severity counts). R6 is satisfied at the call site with zero edits. | 💡 recommendation         |
| Q2  | Is `findings` required or optional on the contract?                   | **Required** (`z.array(Finding)`, not `.nullish()`). Spec edge-case note: SPEC 1 merges first, no pre-existing CI artifacts predate this field.                                    | gap (resolved by spec)    |
| Q3  | Does `loadMemory()` (plan Q10 / SPEC 3 clarification 10) belong here? | **No.** Explicitly out of scope for this plan; belongs to SPEC 3's memory feature. Flagged below as a known future addition to this package.                                       | 🚩 red flag (scope guard) |

## Affected Modules

| Module                           | Path                                            | Change Type                                                         |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| shared contracts (server mirror) | `server/src/vendor/shared/contracts/eval-ci.ts` | Modify                                                              |
| shared contracts (client mirror) | `client/src/vendor/shared/contracts/eval-ci.ts` | Modify                                                              |
| agent-runner artifact builder    | `agent-runner/src/artifact.ts`                  | Modify                                                              |
| agent-runner tests               | `agent-runner/src/run.test.ts`                  | Modify (extend)                                                     |
| agent-runner orchestrator        | `agent-runner/src/run.ts`                       | **No change** — already passes `outcome.review.findings` (verified) |

## Verified current state (before change)

- `server/.../eval-ci.ts` and `client/.../eval-ci.ts` — `CiResultArtifact = z.object({ findings_count, critical?, warning?, suggestion?, cost_usd, duration_ms?, agent, version?, pr_number? })`. **`Finding` is already imported** in both files (server: `import { … Finding … } from "./findings.js"`; client: `from "./findings"`). No new import needed.
- `agent-runner/src/artifact.ts` — `BuildResultArtifactInput` already declares `findings: Finding[]`. `buildResultArtifact` computes `severityCounts(input.findings)` and builds `candidate` WITHOUT a `findings` key today, then `CiResultArtifact.safeParse(candidate)` → throws `RunnerError` on failure.
- `agent-runner/src/run.ts` — step 6 already calls `buildResultArtifact({ findings: outcome.review.findings, costUsd, durationMs, agent, prNumber })`. `outcome.review.findings` is the grounded array (post-`reviewPullRequest`, same array feeding `countBlockers`/`toReviewPayload`). **No edit required.**
- `agent-runner/src/run.test.ts` — existing hermetic suite: `GROUNDED_PLUS_HALLUCINATED_REVIEW` (grounded `id:'f1'` CRITICAL on line 10 + hallucinated `id:'f-hallucinated'` on line 999), `ALL_HALLUCINATED_REVIEW`, and `AC-26` test that reads `devdigest-result.json` from disk and `safeParse`s it. No `artifact.test.ts` file exists — new unit assertions go into `run.test.ts` (or a new `artifact.test.ts`; see TASK-003).

## Tasks

### TASK-001: Extend `CiResultArtifact` contract in both mirrors

**Scope:** both (shared contract)

**Owned Paths:**

- `server/src/vendor/shared/contracts/eval-ci.ts`
- `client/src/vendor/shared/contracts/eval-ci.ts`

**Concrete change:** In each file's `CiResultArtifact = z.object({ … })`, add a single required field `findings: z.array(Finding)` (reusing the already-imported `Finding`). Do not remove/rename/reorder any existing field. Keep both objects byte-identical in shape. No new imports (Finding already imported in both).

**Acceptance Criteria:**

- [ ] AC-001 (→ AC-1): both mirrors gain `findings: z.array(Finding)`; all existing fields (`findings_count`, `critical`, `warning`, `suggestion`, `cost_usd`, `duration_ms`, `agent`, `version`, `pr_number`) unchanged.
- [ ] AC-002 (→ AC-2): the `CiResultArtifact` shape (field set + types) is identical between server and client mirrors.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-001 | `git diff` on both files shows ONLY the added `findings` line; `cd server && pnpm typecheck` and `cd client && pnpm typecheck` green. |
| AC-002 | Visual/`diff`-of-the-`CiResultArtifact`-block between the two files → empty. |

---

### TASK-002: Include `findings` in the built artifact

**Scope:** backend (agent-runner)

**Owned Paths:**

- `agent-runner/src/artifact.ts`

**Concrete change:** In `buildResultArtifact`, add `findings: input.findings` to the `candidate` object (alongside `findings_count`, counts, etc.). No change to the `safeParse` / `RunnerError` throw logic — it now validates the new field too. `BuildResultArtifactInput` already carries `findings`, so no signature change.

**Acceptance Criteria:**

- [ ] AC-003 (→ AC-3): `buildResultArtifact` output includes `findings` equal to `input.findings`; validates via the same `CiResultArtifact.safeParse`.
- [ ] AC-004 (→ AC-4): a malformed finding (e.g. severity out of enum) makes `CiResultArtifact.safeParse` fail → `RunnerError` thrown (no partial artifact returned).
- [ ] AC-005 (→ AC-5): `result.findings.length === result.findings_count`.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-003 | Unit: `buildResultArtifact` with N findings → `result.findings.length === N` and deep-equals input; `safeParse` success (covered by TASK-003 tests). |
| AC-004 | Unit: pass a finding with `severity: 'BOGUS'` → expect `buildResultArtifact` to throw `RunnerError`. |
| AC-005 | Unit + run: `findings.length === findings_count` for grounded review. |

> Depends on TASK-001 (schema must require `findings` for the safeParse to validate it).

---

### TASK-003: Tests — artifact carries shaped findings; grounded parity; hard-fail unchanged

**Scope:** backend (agent-runner)

**Owned Paths:**

- `agent-runner/src/run.test.ts` (extend existing suite)
- _(optional)_ `agent-runner/src/artifact.test.ts` (new file for the pure-unit `buildResultArtifact` cases, if preferred over inlining into `run.test.ts`)

**Concrete change:** Add/extend assertions:

1. **Grounded emit (→ AC-6):** using `GROUNDED_PLUS_HALLUCINATED_REVIEW`, after `runCi`, assert `result.artifact!.findings` has length 1, `findings[0].id === 'f1'`, `findings[0].severity === 'CRITICAL'`, and NO element with `start_line === 999` (hallucinated dropped by grounding).
2. **Invariant (→ AC-5):** assert `result.artifact!.findings.length === result.artifact!.findings_count`.
3. **On-disk shape (→ AC-8):** extend the existing AC-26 test — after `CiResultArtifactSchema.safeParse(onDisk)` success, assert `parsed.data.findings[0].id === 'f1'` and `parsed.data.findings[0].severity === 'CRITICAL'`.
4. **Hard-fail unchanged (→ AC-7):** reuse the existing `'throw'` stub test — additionally confirm `result.artifact === null` and the file is not created (already asserted; keep green).
5. **Malformed finding → RunnerError (→ AC-4):** pure unit on `buildResultArtifact` (or via a stub review with an invalid finding) asserting `RunnerError` is thrown.

**Acceptance Criteria:**

- [ ] AC-006 (→ AC-6): after `runCi`, `artifact.findings` contains only the grounded finding (`id 'f1'`); hallucinated (line 999) absent.
- [ ] AC-007 (→ AC-8): the file read back from disk `safeParse`s and `findings[0]` is well-shaped.
- [ ] AC-008 (→ AC-7): hard-fail (`'throw'` stub) → `artifact === null`, no file written.

**Verification:**
| AC | How to measure |
|----|----------------|
| AC-006 / AC-007 / AC-008 | `cd agent-runner && pnpm test` (or the package's configured vitest command) → all green. |

## Implementation Phases

> ⚙️ Execution mode: **single-agent** (sequential). All three tasks touch interdependent code; no parallel owned-path split.

### Phase 1: Contract (schema)

- [ ] TASK-001 — add `findings: z.array(Finding)` to `CiResultArtifact` in both `eval-ci.ts` mirrors.

### Phase 2: Artifact builder

- [ ] TASK-002 — add `findings: input.findings` to the `candidate` in `buildResultArtifact` (`agent-runner/src/artifact.ts`).
- [ ] Confirm `run.ts` needs NO change (already passes `outcome.review.findings`).

### Phase 3: Tests

- [ ] TASK-003 — extend `run.test.ts` (and optionally add `artifact.test.ts`) per AC-4/5/6/7/8.

## Self-verification checklist

- [ ] `cd server && pnpm typecheck` — green (server mirror change compiles).
- [ ] `cd client && pnpm typecheck` — green (client mirror change compiles).
- [ ] `cd agent-runner && pnpm typecheck` — green (artifact.ts + tests compile).
- [ ] `cd agent-runner && pnpm test` — all agent-runner tests pass (new findings assertions + existing AC-20..26, AC-36, Q5).
- [ ] `git diff` on both `eval-ci.ts` mirrors shows only the added `findings` line; shapes identical.
- [ ] `git diff` on `run.ts` is empty (no change expected).
- [ ] No `verdict` field added anywhere; no `reviewer-core` change; no `reviews/` module change; no new agent-runner runtime dependency (check `agent-runner/package.json` unchanged).
- [ ] **Bundle note (NOT required for tests):** `pnpm --dir agent-runner build` (ncc → `dist/index.js`, gitignored) is NOT needed to land or test this PR. It IS required later by SPEC 2's export consumer (server reads `agent-runner/dist/index.js` from disk). Rebuild before/at SPEC 2, not here.

## Dependencies / Ordering

- **TASK-001 before TASK-002:** the schema must declare `findings` as required before the builder's `safeParse` validates it (same PR; final state is order-independent, but for incremental correctness do the contract first).
- **TASK-002 before TASK-003:** tests assert the emitted `findings`.
- **Cross-PR:** SPEC 2's ingest (PR 2) consumes these emitted findings — this PR is a prerequisite and merges first.

## Risks & Mitigations

| Risk                                                | Mitigation                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Mirrors drift (server vs client `CiResultArtifact`) | AC-002 explicit identical-shape check; add identical `findings: z.array(Finding)` line to both in one task. |
| Making `findings` required breaks an older artifact | Not possible: SPEC 1 merges first; no CI artifacts predate this field (spec edge-case accepted risk).       |
| Accidentally editing `run.ts` unnecessarily         | Verify `git diff` on `run.ts` is empty; the call site already passes grounded findings.                     |

## Out of Scope

- `verdict` field anywhere (contract, artifact, DB) — CI Runs uses STATUS + FINDINGS (SPEC 2 Q11).
- `reviewer-core` changes (grounding gate, `toReviewPayload`, `countBlockers`, `gateTriggered`).
- `reviews/` module and the server-local review pipeline.
- Ingest / `ci_runs` / CI Runs page / Export Wizard — SPEC 2.
- Deterministic ordering/sort of findings in the artifact — deferred (spec `[NEEDS CLARIFICATION]`; SPEC 2 render owns ordering if needed).

## Known future addition to this package (NOT this PR)

- **`loadMemory()`** — per EXPORT_TO_CI_PLAN.md (plan Q10 / SPEC 3 clarification 10), the runner will add a `loadMemory()` (mirroring `loadSkillBodies`) that reads `.devdigest/memory.jsonl` and passes `memory: string[]` into `reviewPullRequest`. This belongs to **SPEC 3 (Memory subsystem)** and is planned there — deliberately excluded from this PR.

## Architecture Notes

- `Finding` is the single source of truth in `contracts/findings.ts`; both `eval-ci.ts` mirrors already import it — reuse, do not redefine (AC-1).
- The emitted array is the GROUNDED result (`outcome.review.findings`), identical to what feeds severity counts and GitHub posting — guaranteeing `findings.length === findings_count` (AC-5) and parity with local runs (AC-6). No extra LLM call, no second grounding pass.
- `buildResultArtifact` keeps its "validate-or-throw" contract: the same `CiResultArtifact.safeParse` now also guards the new field (AC-4).
