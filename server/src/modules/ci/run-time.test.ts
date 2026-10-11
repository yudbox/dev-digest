import { describe, it, expect } from "vitest";
import { ciRunTime } from "./run-time.js";

const NOW = new Date("2026-10-11T12:00:00Z");

describe("ciRunTime", () => {
  it("prefers GitHub's run start, then its creation time", () => {
    expect(ciRunTime({ runStartedAt: "2026-10-01T08:00:00Z", createdAt: "2026-10-01T07:59:00Z" }, NOW).toISOString()).toBe(
      "2026-10-01T08:00:00.000Z",
    );
    expect(ciRunTime({ runStartedAt: null, createdAt: "2026-10-01T07:59:00Z" }, NOW).toISOString()).toBe(
      "2026-10-01T07:59:00.000Z",
    );
  });

  it("uses `now` only when GitHub reports no usable time", () => {
    expect(ciRunTime({}, NOW)).toBe(NOW);
    expect(ciRunTime({ runStartedAt: "not a date", createdAt: undefined }, NOW)).toBe(NOW);
  });
});
