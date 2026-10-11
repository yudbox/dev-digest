import { describe, it, expect } from "vitest";
import { BadRequestError } from "../../platform/errors.js";
import { addLocalDays, isValidTimeZone, resolveWindow, zonedParts, zonedToUtc } from "./window.js";

const KYIV = "Europe/Kyiv";

/** Wall-clock label of an ISO instant in a zone, e.g. "10-10 16:00". */
function local(isoStr: string, tz: string): string {
  const w = zonedParts(new Date(isoStr), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(w.m)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
}

describe("zone helpers", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("Europe/Kyiv")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("round-trips a wall reading through a zone", () => {
    const d = zonedToUtc({ y: 2026, m: 10, d: 11, h: 12, mi: 22, s: 0 }, KYIV);
    // Kyiv is UTC+3 on 2026-10-11 (EEST).
    expect(d.toISOString()).toBe("2026-10-11T09:22:00.000Z");
    expect(zonedParts(d, KYIV)).toMatchObject({ y: 2026, m: 10, d: 11, h: 12, mi: 22 });
  });

  it("adds local days across a DST change on wall-clock time", () => {
    // Kyiv leaves DST on 2026-10-25: a local day there is 25h long.
    const before = zonedToUtc({ y: 2026, m: 10, d: 24, h: 12, mi: 0, s: 0 }, KYIV);
    const after = addLocalDays(before, 1, KYIV);
    expect(zonedParts(after, KYIV)).toMatchObject({ d: 25, h: 12 });
  });
});

describe("resolveWindow — 30d", () => {
  const now = new Date("2026-10-11T09:22:00Z"); // 12:22 in Kyiv
  const w = resolveWindow({ kind: "30d" }, KYIV, now);

  it("is the rolling 30×24h window ending now", () => {
    expect(w.kind).toBe("30d");
    expect(w.from).toBe("2026-09-11T09:22:00.000Z");
    expect(w.to).toBe(now.toISOString());
    expect(w.days).toBe(30);
    expect(w.bucketKind).toBe("week");
  });

  it("cuts 5 weeks from the period start; the last is 2 days and partial", () => {
    expect(w.buckets.map((b) => b.label)).toEqual(["W1", "W2", "W3", "W4", "W5"]);
    expect(w.buckets[0]!.start).toBe("2026-09-11T09:22:00.000Z");
    expect(w.buckets[0]!.end).toBe("2026-09-18T09:22:00.000Z");
    expect(w.buckets[3]!.end).toBe("2026-10-09T09:22:00.000Z");
    expect(w.buckets[4]!.start).toBe("2026-10-09T09:22:00.000Z");
    expect(w.buckets[4]!.end).toBe(now.toISOString());
    expect(w.buckets[4]!.partial).toBe(true);
    expect(w.buckets.slice(0, 4).every((b) => !b.partial)).toBe(true);
  });

  it("buckets tile the window without gaps or overlap", () => {
    for (let i = 1; i < w.buckets.length; i++) {
      expect(w.buckets[i]!.start).toBe(w.buckets[i - 1]!.end);
    }
  });

  it("previous window is the 30 days before `from`", () => {
    expect(w.previous.to).toBe(w.from);
    expect(w.previous.from).toBe("2026-08-12T09:22:00.000Z");
  });
});

describe("resolveWindow — 1d (six fixed 4-hour slots, last one current)", () => {
  it("at 12:22 local → 16–20, 20–24, 00–04, 04–08, 08–12, 12–16", () => {
    const now = new Date("2026-10-11T09:22:00Z");
    const w = resolveWindow({ kind: "1d" }, KYIV, now);
    expect(w.buckets).toHaveLength(6);
    expect(w.buckets.map((b) => b.label)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6"]);
    expect(w.buckets.map((b) => local(b.start, KYIV))).toEqual([
      "10-10 16:00",
      "10-10 20:00",
      "10-11 00:00",
      "10-11 04:00",
      "10-11 08:00",
      "10-11 12:00",
    ]);
    expect(local(w.buckets[5]!.end, KYIV)).toBe("10-11 16:00");
    expect(w.buckets[5]!.partial).toBe(true);
    expect(w.buckets.slice(0, 5).every((b) => !b.partial)).toBe(true);
    expect(w.from).toBe(w.buckets[0]!.start);
    expect(w.to).toBe(now.toISOString());
  });

  it("at 07:50 local → 08–12 … 04–08 of the next day", () => {
    const now = new Date("2026-10-11T04:50:00Z"); // 07:50 Kyiv
    const w = resolveWindow({ kind: "1d" }, KYIV, now);
    expect(w.buckets.map((b) => local(b.start, KYIV))).toEqual([
      "10-10 08:00",
      "10-10 12:00",
      "10-10 16:00",
      "10-10 20:00",
      "10-11 00:00",
      "10-11 04:00",
    ]);
  });

  it("is stable inside one slot (13:22 and 14:22 give the same slots)", () => {
    const a = resolveWindow({ kind: "1d" }, KYIV, new Date("2026-10-11T10:22:00Z"));
    const b = resolveWindow({ kind: "1d" }, KYIV, new Date("2026-10-11T11:22:00Z"));
    expect(a.buckets.map((x) => x.start)).toEqual(b.buckets.map((x) => x.start));
  });

  it("works in UTC (09:22Z is inside the 08–12 slot)", () => {
    const w = resolveWindow({ kind: "1d" }, "UTC", new Date("2026-10-11T09:22:00Z"));
    expect(w.buckets[0]!.start).toBe("2026-10-10T12:00:00.000Z");
    expect(w.buckets[5]!.start).toBe("2026-10-11T08:00:00.000Z");
    expect(w.buckets[5]!.partial).toBe(true);
  });

  it("previous window is the 24 local hours before `from`", () => {
    const w = resolveWindow({ kind: "1d" }, KYIV, new Date("2026-10-11T09:22:00Z"));
    expect(w.previous.to).toBe(w.from);
    expect(local(w.previous.from, KYIV)).toBe("10-09 16:00");
  });
});

describe("resolveWindow — custom", () => {
  const at = (iso: string) => new Date(iso);

  it("Oct 1…Oct 3 viewed at 12:22 on Oct 3 is [Oct 1 00:00, Oct 3 12:22) with day buckets", () => {
    const now = at("2026-10-03T09:22:00Z"); // 12:22 Kyiv
    const from = zonedToUtc({ y: 2026, m: 10, d: 1, h: 0, mi: 0, s: 0 }, KYIV);
    const to = zonedToUtc({ y: 2026, m: 10, d: 4, h: 0, mi: 0, s: 0 }, KYIV);
    const w = resolveWindow({ kind: "custom", from, to }, KYIV, now);
    expect(w.kind).toBe("custom");
    expect(w.days).toBe(3);
    expect(w.bucketKind).toBe("day");
    expect(w.buckets.map((b) => b.label)).toEqual(["D1", "D2", "D3"]);
    expect(w.from).toBe(from.toISOString());
    expect(w.to).toBe(now.toISOString()); // capped at now
    expect(w.buckets[2]!.partial).toBe(true);
    expect(w.buckets[2]!.end).toBe(now.toISOString());
    expect(w.previous.to).toBe(from.toISOString());
  });

  it("a 1-day custom range uses the six H slots of that day", () => {
    const now = at("2026-10-11T09:22:00Z");
    const from = zonedToUtc({ y: 2026, m: 10, d: 5, h: 0, mi: 0, s: 0 }, KYIV);
    const to = zonedToUtc({ y: 2026, m: 10, d: 6, h: 0, mi: 0, s: 0 }, KYIV);
    const w = resolveWindow({ kind: "custom", from, to }, KYIV, now);
    expect(w.days).toBe(1);
    expect(w.bucketKind).toBe("hour");
    expect(w.buckets.map((b) => local(b.start, KYIV))).toEqual([
      "10-05 00:00",
      "10-05 04:00",
      "10-05 08:00",
      "10-05 12:00",
      "10-05 16:00",
      "10-05 20:00",
    ]);
    expect(w.buckets.every((b) => !b.partial)).toBe(true);
  });

  it("a 10-day range is D1…D10", () => {
    const now = at("2026-10-20T09:22:00Z");
    const from = zonedToUtc({ y: 2026, m: 10, d: 1, h: 0, mi: 0, s: 0 }, KYIV);
    const to = zonedToUtc({ y: 2026, m: 10, d: 11, h: 0, mi: 0, s: 0 }, KYIV);
    const w = resolveWindow({ kind: "custom", from, to }, KYIV, now);
    expect(w.bucketKind).toBe("day");
    expect(w.buckets).toHaveLength(10);
    expect(w.buckets[9]!.label).toBe("D10");
  });

  it("a 17-day range is rolling weeks W1…W3, the last one 3 days and partial", () => {
    const now = at("2026-10-25T09:22:00Z");
    const from = zonedToUtc({ y: 2026, m: 10, d: 1, h: 0, mi: 0, s: 0 }, KYIV);
    const to = zonedToUtc({ y: 2026, m: 10, d: 18, h: 0, mi: 0, s: 0 }, KYIV);
    const w = resolveWindow({ kind: "custom", from, to }, KYIV, now);
    expect(w.days).toBe(17);
    expect(w.bucketKind).toBe("week");
    expect(w.buckets.map((b) => b.label)).toEqual(["W1", "W2", "W3"]);
    expect(w.buckets[2]!.partial).toBe(true);
    expect(w.buckets[2]!.end).toBe(to.toISOString());
  });

  it("a day lying fully after now is returned with zero-width future bucket, not partial", () => {
    const now = at("2026-10-02T09:22:00Z");
    const from = zonedToUtc({ y: 2026, m: 10, d: 1, h: 0, mi: 0, s: 0 }, KYIV);
    const to = zonedToUtc({ y: 2026, m: 10, d: 4, h: 0, mi: 0, s: 0 }, KYIV);
    const w = resolveWindow({ kind: "custom", from, to }, KYIV, now);
    expect(w.buckets).toHaveLength(3);
    expect(w.buckets[2]!.partial).toBe(false);
  });

  it("rejects ranges over 30 days, even by a minute", () => {
    const now = at("2026-12-31T00:00:00Z");
    const from = zonedToUtc({ y: 2026, m: 10, d: 1, h: 0, mi: 0, s: 0 }, KYIV);
    const ok = zonedToUtc({ y: 2026, m: 10, d: 31, h: 0, mi: 0, s: 0 }, KYIV);
    expect(() => resolveWindow({ kind: "custom", from, to: ok }, KYIV, now)).not.toThrow();
    const tooLong = new Date(ok.getTime() + 60_000);
    expect(() => resolveWindow({ kind: "custom", from, to: tooLong }, KYIV, now)).toThrow(BadRequestError);
  });

  it("rejects to<=from, a future `from` and a bad time zone", () => {
    const now = at("2026-10-11T09:22:00Z");
    const d = at("2026-10-05T00:00:00Z");
    expect(() => resolveWindow({ kind: "custom", from: d, to: d }, KYIV, now)).toThrow(BadRequestError);
    const future = at("2026-10-20T00:00:00Z");
    const futureTo = at("2026-10-21T00:00:00Z");
    expect(() => resolveWindow({ kind: "custom", from: future, to: futureTo }, KYIV, now)).toThrow(BadRequestError);
    expect(() => resolveWindow({ kind: "30d" }, "Mars/Base", now)).toThrow(BadRequestError);
  });
});
