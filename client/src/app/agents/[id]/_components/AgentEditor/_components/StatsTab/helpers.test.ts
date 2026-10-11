import { describe, it, expect } from "vitest";
import { noDataBefore, prefetchIndex, sharePct, toSeverityBars, totalTokens } from "./helpers";
import type { Translate } from "@/lib/utils/period";

const t: Translate = (key) => ({ "bucket.now": "now", "bucket.partial": "partial", "bucket.inProgress": "in progress" })[key] ?? key;

describe("StatsTab helpers", () => {
  it("shares are whole percents, 0 for an empty whole", () => {
    expect(sharePct(2, 3)).toBe(67);
    expect(sharePct(0, 0)).toBe(0);
  });

  it("builds one bar per bucket with its exact range as the tooltip", () => {
    const bars = toSeverityBars(
      [
        { label: "W1", start: "2026-09-11T09:22:00.000Z", end: "2026-09-18T09:22:00.000Z", partial: false, critical: 2, warning: 5, suggestion: 8 },
        { label: "W5", start: "2026-10-09T09:22:00.000Z", end: "2026-10-11T09:22:00.000Z", partial: true, critical: 0, warning: 0, suggestion: 1 },
      ],
      { bucketKind: "week", tz: "UTC" },
      t,
    );
    expect(bars.map((b) => b.label)).toEqual(["W1", "W5"]);
    expect(bars[0]).toMatchObject({ critical: 2, warning: 5, suggestion: 8, tooltip: "W1: Sep 11 09:22 – Sep 18 09:22" });
    expect(bars[1]!.tooltip).toBe("W5: Oct 9 09:22 – now · partial");
  });

  it("says 'No data before <date>' only when the window starts before the tracking start", () => {
    expect(noDataBefore("2026-09-11T00:00:00Z", "2026-09-30T08:00:00Z", "UTC")).toBe("Sep 30");
    expect(noDataBefore("2026-10-05T00:00:00Z", "2026-09-30T08:00:00Z", "UTC")).toBeNull();
    expect(noDataBefore("2026-09-11T00:00:00Z", null, "UTC")).toBeNull();
  });

  it("totals tokens, with null when neither is known", () => {
    expect(totalTokens(100, 50)).toBe(150);
    expect(totalTokens(null, 50)).toBe(50);
    expect(totalTokens(null, null)).toBeNull();
  });

  it("prefetches from the 5th row from the end", () => {
    expect(prefetchIndex(10)).toBe(5);
    expect(prefetchIndex(3)).toBe(0);
    expect(prefetchIndex(0)).toBe(0);
  });
});
