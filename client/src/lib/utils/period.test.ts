import { describe, it, expect } from "vitest";
import type { StatsWindow } from "@devdigest/shared";
import {
  DEFAULT_PERIOD,
  customRangeDays,
  formatBucketTooltip,
  formatWindowCaption,
  adjustRange,
  defaultCustomRange,
  isValidCustomRange,
  maxToFor,
  minFromFor,
  parseStoredPeriod,
  periodToQuery,
  serializePeriod,
  type Translate,
} from "./period";

/** Minimal translator over the real message templates used by the formatters. */
const messages: Record<string, string> = {
  "caption.oneDay": "1 day · {from} – now",
  "caption.thirtyDays": "30 days · {from} – now",
  "caption.custom": "{from} – {to}",
  "bucket.inProgress": "in progress",
  "bucket.partial": "partial",
  "bucket.now": "now",
};
const t: Translate = (key, values = {}) =>
  (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

describe("parseStoredPeriod", () => {
  it("defaults to 30 days when nothing is stored or the value is corrupted", () => {
    expect(parseStoredPeriod(null)).toEqual(DEFAULT_PERIOD);
    expect(parseStoredPeriod("")).toEqual(DEFAULT_PERIOD);
    expect(parseStoredPeriod("{not json")).toEqual(DEFAULT_PERIOD);
    expect(parseStoredPeriod('{"kind":"7d"}')).toEqual(DEFAULT_PERIOD);
    expect(parseStoredPeriod("42")).toEqual(DEFAULT_PERIOD);
    expect(parseStoredPeriod('{"kind":"custom"}')).toEqual(DEFAULT_PERIOD);
  });

  it("round-trips presets and a valid custom range", () => {
    for (const p of [{ kind: "1d" }, { kind: "30d" }, { kind: "custom", from: "2026-09-01", to: "2026-09-10" }] as const) {
      expect(parseStoredPeriod(serializePeriod(p))).toEqual(p);
    }
  });

  it("keeps a valid PAST custom range but rejects one longer than 30 days or reversed or fake", () => {
    expect(parseStoredPeriod('{"kind":"custom","from":"2024-01-01","to":"2024-01-30"}')).toEqual({
      kind: "custom",
      from: "2024-01-01",
      to: "2024-01-30",
    });
    expect(parseStoredPeriod('{"kind":"custom","from":"2026-09-01","to":"2026-10-01"}')).toEqual(DEFAULT_PERIOD); // 31 days
    expect(parseStoredPeriod('{"kind":"custom","from":"2026-09-10","to":"2026-09-01"}')).toEqual(DEFAULT_PERIOD);
    expect(parseStoredPeriod('{"kind":"custom","from":"2026-02-30","to":"2026-03-02"}')).toEqual(DEFAULT_PERIOD);
  });
});

describe("custom range helpers", () => {
  it("counts inclusive days and enforces the 30-day cap", () => {
    expect(customRangeDays("2026-10-01", "2026-10-01")).toBe(1);
    expect(customRangeDays("2026-10-01", "2026-10-30")).toBe(30);
    expect(isValidCustomRange("2026-10-01", "2026-10-30")).toBe(true);
    expect(isValidCustomRange("2026-10-01", "2026-10-31")).toBe(false);
  });

  it("limits the picker: max `to` is from+29 days and never after today", () => {
    expect(maxToFor("2026-10-01", "2026-12-31")).toBe("2026-10-30");
    expect(maxToFor("2026-10-01", "2026-10-05")).toBe("2026-10-05");
    expect(minFromFor("2026-10-30")).toBe("2026-10-01");
  });
});

describe("periodToQuery", () => {
  it("sends presets as range + the IANA zone", () => {
    expect(periodToQuery({ kind: "30d" }, "Europe/Kyiv")).toBe("range=30d&tz=Europe%2FKyiv");
    expect(periodToQuery({ kind: "1d" }, "UTC")).toBe("range=1d&tz=UTC");
  });

  it("sends a custom range as local-midnight ISO bounds [D1 00:00, D2+1 00:00)", () => {
    const q = new URLSearchParams(periodToQuery({ kind: "custom", from: "2026-10-01", to: "2026-10-03" }, "UTC"));
    expect(q.get("range")).toBeNull();
    expect(q.get("from")).toBe(new Date(2026, 9, 1).toISOString());
    expect(q.get("to")).toBe(new Date(2026, 9, 4).toISOString());
    expect(q.get("tz")).toBe("UTC");
  });
});

describe("window captions and bucket tooltips", () => {
  const base: Omit<StatsWindow, "kind" | "from" | "to"> = {
    tz: "UTC",
    previous: { from: "", to: "" },
    buckets: [],
    days: 1,
    bucketKind: "hour",
  };

  it("captions the 1-day window without any period suffix", () => {
    const w: StatsWindow = { ...base, kind: "1d", from: "2026-10-10T16:00:00.000Z", to: "2026-10-11T09:22:00.000Z" };
    expect(formatWindowCaption(w, t)).toBe("1 day · Oct 10 16:00 – now");
  });

  it("captions 30 days and a custom range", () => {
    const w30: StatsWindow = { ...base, kind: "30d", bucketKind: "week", days: 30, from: "2026-09-11T09:22:00.000Z", to: "2026-10-11T09:22:00.000Z" };
    expect(formatWindowCaption(w30, t)).toBe("30 days · Sep 11 – now");
    const wc: StatsWindow = { ...base, kind: "custom", bucketKind: "day", days: 3, from: "2026-10-01T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" };
    expect(formatWindowCaption(wc, t)).toBe("Oct 1 – Oct 3");
  });

  it("shows the exact range for a complete hour slot, with 24:00 at midnight", () => {
    const h2 = { label: "H2", start: "2026-10-10T20:00:00.000Z", end: "2026-10-11T00:00:00.000Z", partial: false };
    expect(formatBucketTooltip(h2, "hour", "UTC", t)).toBe("H2: Oct 10 20:00–24:00");
  });

  it("marks the current hour slot in progress and a partial week as partial", () => {
    const h6 = { label: "H6", start: "2026-10-11T12:00:00.000Z", end: "2026-10-11T16:00:00.000Z", partial: true };
    expect(formatBucketTooltip(h6, "hour", "UTC", t)).toBe("H6: Oct 11 12:00 – now · in progress");
    const w5 = { label: "W5", start: "2026-10-09T12:22:00.000Z", end: "2026-10-11T12:22:00.000Z", partial: true };
    expect(formatBucketTooltip(w5, "week", "UTC", t)).toBe("W5: Oct 9 12:22 – now · partial");
    const w1 = { label: "W1", start: "2026-09-11T12:22:00.000Z", end: "2026-09-18T12:22:00.000Z", partial: false };
    expect(formatBucketTooltip(w1, "week", "UTC", t)).toBe("W1: Sep 11 12:22 – Sep 18 12:22");
  });

  it("labels day buckets by date", () => {
    const d2 = { label: "D2", start: "2026-10-02T00:00:00.000Z", end: "2026-10-03T00:00:00.000Z", partial: false };
    expect(formatBucketTooltip(d2, "day", "UTC", t)).toBe("D2: Oct 2");
  });
});

describe("custom range editing", () => {
  const today = "2026-10-11";

  it("offers the last 7 days by default", () => {
    expect(defaultCustomRange(today)).toEqual({ from: "2026-10-05", to: today });
  });

  it("moves `to` when `from` is set after it, or the range would exceed 30 days", () => {
    expect(adjustRange({ from: "2026-10-09", to: "2026-10-08" }, "from", today)).toEqual({ from: "2026-10-09", to: "2026-10-09" });
    expect(adjustRange({ from: "2026-08-01", to: "2026-10-11" }, "from", today)).toEqual({ from: "2026-08-01", to: "2026-08-30" });
  });

  it("moves `from` when `to` is set before it, or the range would exceed 30 days", () => {
    expect(adjustRange({ from: "2026-10-05", to: "2026-10-03" }, "to", today)).toEqual({ from: "2026-10-03", to: "2026-10-03" });
    expect(adjustRange({ from: "2026-08-01", to: "2026-10-11" }, "to", today)).toEqual({ from: "2026-09-12", to: "2026-10-11" });
  });

  it("never allows a date in the future and always returns a valid range", () => {
    const r = adjustRange({ from: "2026-10-09", to: "2026-12-31" }, "to", today);
    expect(r.to).toBe(today);
    expect(isValidCustomRange(r.from, r.to)).toBe(true);
    expect(adjustRange({ from: "bad", to: "worse" }, "from", today)).toEqual({ from: today, to: today });
  });
});
