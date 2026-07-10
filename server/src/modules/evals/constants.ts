/**
 * Cap for "recent_runs" style lists across the evals module: the per-owner
 * `EvalDashboard.recent_runs` and the workspace-wide `EvalDashboardOverview.recent_runs`
 * (Q4 — spec's own suggestion).
 */
export const RECENT_RUNS_LIMIT = 20;

/**
 * The single hidden file path used for ALL manually-written finding-grounded
 * skill eval cases (`convention`/`security`/`custom`). These cases are
 * authored by hand via the Code tab (no real PR/diff exists), so there is no
 * real file path to reference — a fixed constant avoids a user-typed path
 * silently desyncing `expected.file` from `actual.file` (the match key).
 * Never surfaced in any DTO. MUST equal the client mirror
 * `SNIPPET_FILE_PATH` in `client/src/components/evals/EvalCaseModal/snippet-diff.ts`.
 */
export const MANUAL_SKILL_CASE_FILE_PATH = 'snippet.ts';
