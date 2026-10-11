import { describe, it, expect } from "vitest";
import { formatAccept, formatRelative, formatSeconds, formatTimestamp, formatTokens, formatUsd } from "./format";

describe("stats formatters", () => {
  it("formats money, with a dash for unknown", () => {
    expect(formatUsd(0.04)).toBe("$0.04");
    expect(formatUsd(10.75)).toBe("$10.75");
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("abbreviates tokens", () => {
    expect(formatTokens(16_000)).toBe("16k");
    expect(formatTokens(15_500)).toBe("16k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(null)).toBe("—");
  });

  it("formats durations in seconds", () => {
    expect(formatSeconds(6200)).toBe("6.2s");
    expect(formatSeconds(5000)).toBe("5s");
    expect(formatSeconds(12_400)).toBe("12s");
    expect(formatSeconds(null)).toBe("—");
  });

  it("formats relative time", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(formatRelative("2026-10-11T11:56:00Z", now)).toBe("4m ago");
    expect(formatRelative("2026-10-11T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelative("2026-10-08T12:00:00Z", now)).toBe("3d ago");
    expect(formatRelative("2026-10-11T11:59:40Z", now)).toBe("just now");
    expect(formatRelative(null, now)).toBe("—");
  });

  it("formats a local timestamp in the given zone", () => {
    expect(formatTimestamp("2026-10-11T09:14:00Z", "UTC")).toBe("2026-10-11 09:14");
    expect(formatTimestamp("2026-10-11T09:14:00Z", "Europe/Kyiv")).toBe("2026-10-11 12:14");
  });

  it("always shows the denominator, and a dash with no decisions", () => {
    expect(formatAccept(30, 40)).toBe("75% (30/40)");
    expect(formatAccept(0, 0)).toBe("—");
    expect(formatAccept(1, 1)).toBe("100% (1/1)");
  });
});
