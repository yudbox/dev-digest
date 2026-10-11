import type { SeverityBucket, StatsWindow } from "@devdigest/shared";
import type { StackedBarDatum } from "@devdigest/ui";
import { formatBucketTooltip, type Translate } from "@/lib/utils/period";

/** Severity buckets → the StackedBar's columns, each with its exact-range tooltip. */
export function toSeverityBars(
  buckets: SeverityBucket[],
  window: Pick<StatsWindow, "bucketKind" | "tz">,
  t: Translate,
): StackedBarDatum[] {
  return buckets.map((b) => ({
    label: b.label,
    tooltip: formatBucketTooltip(b, window.bucketKind, window.tz, t),
    critical: b.critical,
    warning: b.warning,
    suggestion: b.suggestion,
  }));
}

/** applied / loaded as a whole percent (0 when nothing was loaded). */
export function sharePct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * The date to show in "No data before <date>": set when the window starts before
 * the first run for which this fact was recorded, i.e. older runs simply do not
 * have it. null when the window is fully covered (or nothing was ever recorded).
 */
export function noDataBefore(windowFrom: string, trackingSince: string | null, tz: string): string | null {
  if (!trackingSince) return null;
  if (new Date(windowFrom).getTime() >= new Date(trackingSince).getTime()) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(trackingSince));
}

/** Tokens in + out, or null when neither is known (CI runs). */
export function totalTokens(tokensIn: number | null, tokensOut: number | null): number | null {
  if (tokensIn === null && tokensOut === null) return null;
  return (tokensIn ?? 0) + (tokensOut ?? 0);
}

/**
 * Index of the row that triggers loading the next page: the 5th row from the end
 * of what is loaded (so the next page arrives before the user reaches the bottom).
 */
export function prefetchIndex(loaded: number, lookahead = 5): number {
  return Math.max(0, loaded - lookahead);
}
