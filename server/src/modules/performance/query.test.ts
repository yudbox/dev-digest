import { describe, it, expect } from "vitest";
import { BadRequestError } from "../../platform/errors.js";
import { encodeCursor } from "./cursor.js";
import { parsePageQuery, parseStatsQuery } from "./query.js";

const NOW = new Date("2026-10-11T09:22:00Z");
const bad = (raw: Record<string, string>) => () => parseStatsQuery(raw, NOW);

describe("parseStatsQuery", () => {
  it("accepts a preset with a time zone", () => {
    const w = parseStatsQuery({ range: "30d", tz: "Europe/Kyiv" }, NOW);
    expect(w.kind).toBe("30d");
    expect(parseStatsQuery({ range: "1d", tz: "UTC" }, NOW).buckets).toHaveLength(6);
  });

  it("accepts an ISO from/to pair of at most 30 days", () => {
    const w = parseStatsQuery(
      { from: "2026-10-01T00:00:00+03:00", to: "2026-10-04T00:00:00+03:00", tz: "Europe/Kyiv" },
      NOW,
    );
    expect(w.kind).toBe("custom");
    expect(w.days).toBe(3);
  });

  it("400s on every malformed input", () => {
    expect(bad({ range: "7d", tz: "UTC" })).toThrow(BadRequestError); // unknown preset
    expect(bad({ range: "30d" })).toThrow(BadRequestError); // no tz
    expect(bad({ range: "30d", tz: "Mars/Base" })).toThrow(BadRequestError); // bad tz
    expect(bad({ tz: "UTC" })).toThrow(BadRequestError); // nothing
    expect(bad({ from: "2026-10-01T00:00:00Z", tz: "UTC" })).toThrow(BadRequestError); // from only
    expect(bad({ range: "30d", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z", tz: "UTC" })).toThrow(
      BadRequestError,
    ); // both forms
    expect(bad({ from: "yesterday", to: "today", tz: "UTC" })).toThrow(BadRequestError);
    expect(bad({ from: "1", to: "2", tz: "UTC" })).toThrow(BadRequestError); // lenient Date.parse input
    expect(
      bad({ from: "2026-10-05T00:00:00Z", to: "2026-10-04T00:00:00Z", tz: "UTC" }),
    ).toThrow(BadRequestError); // to < from
    expect(
      bad({ from: "2026-09-01T00:00:00Z", to: "2026-10-02T00:00:01Z", tz: "UTC" }),
    ).toThrow(BadRequestError); // 31 days
  });
});

describe("parsePageQuery", () => {
  const id = "11111111-2222-4333-8444-555555555555";

  it("defaults to 10 rows and no cursor", () => {
    expect(parsePageQuery({})).toEqual({ limit: 10, cursor: null });
  });

  it("accepts 1..50 and rejects the rest", () => {
    expect(parsePageQuery({ limit: "50" }).limit).toBe(50);
    expect(() => parsePageQuery({ limit: "51" })).toThrow(BadRequestError);
    expect(() => parsePageQuery({ limit: "0" })).toThrow(BadRequestError);
    expect(() => parsePageQuery({ limit: "abc" })).toThrow(BadRequestError);
    expect(() => parsePageQuery({ limit: "-5" })).toThrow(BadRequestError);
  });

  it("round-trips a cursor and rejects tampered ones", () => {
    const c = { ranAt: "2026-10-10T12:00:00.123456Z", id };
    expect(parsePageQuery({ cursor: encodeCursor(c) }).cursor).toEqual(c);
    expect(() => parsePageQuery({ cursor: "garbage" })).toThrow(BadRequestError);
    expect(() => parsePageQuery({ cursor: Buffer.from("nope|nope").toString("base64url") })).toThrow(
      BadRequestError,
    );
    expect(() =>
      parsePageQuery({ cursor: Buffer.from(`2026-10-10T12:00:00Z|'; DROP TABLE x;--`).toString("base64url") }),
    ).toThrow(BadRequestError);
  });
});
