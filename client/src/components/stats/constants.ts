/** Named thresholds for the stats screens (code constants, not Settings). */

/** Fewer resolved decisions than this → "small sample" next to an accept rate. */
export const SMALL_SAMPLE_DECISIONS = 5;
/** Fewer findings than this → "small sample" on the category donut. */
export const SMALL_SAMPLE_FINDINGS = 10;
/** Accept rate at or above this (%) is shown in the "good" colour. */
export const ACCEPT_GOOD_PCT = 60;
/** Accept-rate change (percentage points) below which no arrow is shown. */
export const ARROW_MIN_PP = 1;

/** Fixed palette: an agent keeps the same colour on every screen and reload. */
export const AGENT_PALETTE = [
  "#ef4444",
  "#f59e0b",
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
] as const;

/** Fixed category colours, shared by Agent Stats and Skill Stats. */
export const CATEGORY_COLORS = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "#8b5cf6",
  style: "var(--accent)",
  test: "var(--ok)",
} as const;
