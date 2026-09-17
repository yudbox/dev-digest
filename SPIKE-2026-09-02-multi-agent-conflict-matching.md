# SPIKE — Multi-Agent Conflict Matching ("Where Agents Disagree")

**Status:** investigation only, not implemented. Written after manually reviewing a real 4-agent run (PR #6557, `GES-IT/Big_Commerce_Remediation/ges-azure-functions`) and reading the actual matcher code.

## Where the logic lives

- `server/src/modules/reviews/conflict-detection.ts` — `isSameLocation()` (clustering predicate) + `computeConflicts()` (clustering + contention/conflict classification)
- Consumed by the Multi-Agent Review page's "Where Agents Disagree" panel (`client/src/app/repos/[repoId]/multi-agent-review/[runId]/_components/WhereAgentsDisagree.tsx`)

## How it actually works today

1. **Clustering** — every finding from every agent column is grouped by `isSameLocation(a, b)`:
   - `a.file === b.file` (exact string match)
   - `rangesOverlap(a.start_line, a.start_line, b.start_line, b.start_line)` — **both sides are collapsed to a single point** (the function is called with `start_line` as both the range start AND end argument on each side). This is NOT a real range overlap check despite `rangesOverlap` being imported for exactly that purpose — a finding citing line 10 and another citing line 7 will never cluster, even if their real evidence spans the same 7–10 block.
   - `jaccardOverlap(a.title, b.title) >= 0.3` — literal word-set overlap on the finding **title only** (not the rationale/body), no semantics.
   - Clustering itself is a single greedy pass: each unclustered finding only gets compared against the cluster's *anchor* (`all[i]`), not against every existing member — so two findings that are each individually similar enough to the anchor but not directly compared to each other can still end up together, but a finding that's similar to a *later* cluster member but not the anchor never joins.

2. **Classification** — for each cluster:
   - `isContention = (≥1 agent that ran did NOT flag this cluster at all) OR (flaggers disagree on severity)`
   - Default view (`showOnlyTrueConflicts=false`) shows any contention — in practice this means **almost every finding**, since most findings are only caught by 1 of N agents, and "1 flagged / N-1 silent" alone counts as contention.
   - `showOnlyTrueConflicts=true` ("Show only conflicts" toggle) requires `flaggerIds.size >= 2 AND hasDivergentSeverity` — this is the only mode that reflects genuine *disagreement* (multiple agents independently found the same thing and rated it differently), as opposed to *coverage gaps* (one agent found something the others missed).

## Concrete miss, observed live

On PR #6557, two agents independently flagged the **same real issue** (`BC_ORDER_CREATED_EVENT_TYPE` removed from `packages/contracts` without a deprecation cycle):

| Agent | File:line cited | Severity | Title |
|---|---|---|---|
| API Contract Reviewer | `packages/contracts/constants.ts:10` | CRITICAL | "BC_ORDER_CREATED_EVENT_TYPE removed from public contracts package without deprecation cycle" |
| Security Reviewer | `packages/contracts/constants.ts:7-10` | WARNING | "Breaking removal of public export BC_ORDER_CREATED_EVENT_TYPE without deprecation" |

Title Jaccard overlap ≈ 0.47 (well above the 0.3 threshold) — text similarity was never the blocker. The two never clustered because `start_line` was `10` vs `7`: a 3-line citation difference on the *same* breaking change. This produced two separate single-flagger "contention" rows instead of one genuine two-flagger "conflict" row (which would have been a much stronger signal: two independent personas agreeing the same symbol removal is a real problem, just disagreeing on severity).

## How this is typically done at scale (reference points, not prescriptions)

- **Dedup by range overlap, not point equality** — SAST/lint aggregators (CodeQL, Semgrep) merge findings whose location ranges intersect, not ones that cite an identical single line.
- **Semantic similarity over literal word overlap** — literal Jaccard on a short title breaks the moment two reviewers phrase the same issue differently ("atomicity broken" vs "races between splits"). Embedding cosine similarity is the standard fix; this repo already has `Embedder`/pgvector wired up for the memory feature, so no new dependency would be needed.
- **Consensus as a first-class signal, not just "contention"** — treat "N/M agents independently flagged the same clustered location" as a confidence multiplier surfaced distinctly (e.g. "confirmed by 4/4"), separate from genuine severity disagreement and separate from ordinary single-agent coverage.
- **An explicit severity-reconciliation policy** — right now the tool only *displays* divergence (CRITICAL vs WARNING) with no resolution rule. Common patterns: most-conservative-wins (any CRITICAL vote keeps it CRITICAL), or a documented median/majority rule. Today the human has to resolve this manually every time.

## Candidate fixes, roughly ordered by cost/impact

1. **Fix `isSameLocation` to use real ranges** (`start_line`/`end_line` on both sides, true `rangesOverlap`) — cheapest, directly fixes the observed miss above. `end_line` already exists on `FindingRecord`.
2. **Surface consensus distinctly from contention** — UI/classification change on top of (1): a cluster with `flaggerIds.size >= 2` and NO divergent severity is agreement, not contention, and today it's not shown as anything special.
3. **Embedding-based title/rationale similarity** instead of/alongside Jaccard — bigger lift, reuses existing embedding infra.
4. **Severity-reconciliation policy** — a product decision (which rule to apply), then a small pure function change.

Not implemented yet — parking this here to revisit later.
