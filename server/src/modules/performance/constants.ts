/**
 * Performance / stats module constants. Thresholds are named constants (not
 * Settings) by design — see the Agent Performance spec (AC-83).
 */

/**
 * Run statuses that count as a finished run. Local runs end `done` / `failed`;
 * CI runs imported from GitHub end `succeeded` / `failed` / `no_findings`.
 * `running`, `cancelled` and NULL never count.
 */
export const COUNTED_STATUSES = ["done", "failed", "succeeded", "no_findings"] as const;

/** Subset of COUNTED_STATUSES that completed successfully (duration averages). */
export const SUCCESS_STATUSES = ["done", "succeeded", "no_findings"] as const;

/** A custom period may span at most this many local days. */
export const MAX_PERIOD_DAYS = 30;

/** Hours per slot of the intraday ("1 day") view and slots per day. */
export const SLOT_HOURS = 4;
export const SLOTS_PER_DAY = 24 / SLOT_HOURS;

/** Custom ranges up to this many days are cut into day buckets; longer into weeks. */
export const MAX_DAY_BUCKET_DAYS = 14;

/** Fewer resolved decisions than this → "small sample". */
export const SMALL_SAMPLE_DECISIONS = 5;

/** Previous window needs at least this many costed runs for an Avg-cost delta. */
export const MIN_PREV_COSTED_RUNS = 5;

/** Donut segments shown at most (6 largest + "Other" when there are more). */
export const MAX_SEGMENTS = 7;

/** Runs kept per agent for the dashboard row expand. */
export const RECENT_RUNS_PER_AGENT = 10;

export const RUN_PAGE_DEFAULT = 10;
export const RUN_PAGE_MAX = 50;

/** Most-pulled-memory bars returned. */
export const MEMORY_BARS_MAX = 8;
export const MEMORY_PREVIEW_CHARS = 80;
