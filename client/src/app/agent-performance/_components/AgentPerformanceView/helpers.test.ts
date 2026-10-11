import { describe, it, expect } from "vitest";
import type { AgentPerfRow } from "@devdigest/shared";
import { acceptPct, acceptTrend, sortAgentRows } from "./helpers";

const row = (over: Partial<AgentPerfRow> & { name: string }): AgentPerfRow => ({
  id: over.name,
  enabled: true,
  runs: 10,
  totalCostUsd: 1,
  avgCostUsd: 0.1,
  runsWithoutCost: 0,
  avgDurationMs: 5000,
  accept: { accepted: 0, resolved: 0 },
  previousAccept: null,
  lastRunAt: "2026-10-10T00:00:00.000Z",
  costSource: null,
  recentRuns: [],
  ...over,
});
const names = (rows: AgentPerfRow[]) => rows.map((r) => r.name);

describe("sortAgentRows — Accept", () => {
  const rows = [
    row({ name: "Big", accept: { accepted: 78, resolved: 100 } }), // 78%, enough decisions
    row({ name: "Mid", accept: { accepted: 32, resolved: 50 } }), // 64%
    row({ name: "Lucky", accept: { accepted: 3, resolved: 3 } }), // 100% but a small sample
    row({ name: "Unjudged", accept: { accepted: 0, resolved: 0 } }),
    row({ name: "Low", accept: { accepted: 20, resolved: 50 } }), // 40%
  ];

  it("puts agents with enough decisions first, then small samples, then no decisions (desc)", () => {
    expect(names(sortAgentRows(rows, "accept", "desc"))).toEqual(["Big", "Mid", "Low", "Lucky", "Unjudged"]);
  });

  it("keeps the same tiers when ascending — a small sample never beats real data", () => {
    expect(names(sortAgentRows(rows, "accept", "asc"))).toEqual(["Low", "Mid", "Big", "Lucky", "Unjudged"]);
  });

  it("treats exactly 5 decisions as enough and 4 as small", () => {
    const out = sortAgentRows(
      [
        row({ name: "Four", accept: { accepted: 4, resolved: 4 } }),
        row({ name: "Five", accept: { accepted: 3, resolved: 5 } }),
      ],
      "accept",
      "desc",
    );
    expect(names(out)).toEqual(["Five", "Four"]);
  });
});

describe("sortAgentRows — other columns", () => {
  it("sorts numerically in both directions", () => {
    const rows = [row({ name: "A", runs: 5 }), row({ name: "B", runs: 50 }), row({ name: "C", runs: 20 })];
    expect(names(sortAgentRows(rows, "runs", "desc"))).toEqual(["B", "C", "A"]);
    expect(names(sortAgentRows(rows, "runs", "asc"))).toEqual(["A", "C", "B"]);
  });

  it("puts rows without a value ('—') after rows with values, in both directions", () => {
    const rows = [
      row({ name: "Idle", runs: 0, avgCostUsd: null, avgDurationMs: null, lastRunAt: null }),
      row({ name: "Cheap", avgCostUsd: 0.01 }),
      row({ name: "Pricey", avgCostUsd: 0.5 }),
    ];
    expect(names(sortAgentRows(rows, "avgCost", "asc"))).toEqual(["Cheap", "Pricey", "Idle"]);
    expect(names(sortAgentRows(rows, "avgCost", "desc"))).toEqual(["Pricey", "Cheap", "Idle"]);
    expect(names(sortAgentRows(rows, "lastRun", "desc")).at(-1)).toBe("Idle");
  });

  it("sorts by last run time, newest first when descending", () => {
    const rows = [
      row({ name: "Old", lastRunAt: "2026-09-01T00:00:00.000Z" }),
      row({ name: "New", lastRunAt: "2026-10-10T00:00:00.000Z" }),
    ];
    expect(names(sortAgentRows(rows, "lastRun", "desc"))).toEqual(["New", "Old"]);
  });

  it("always leaves the Deleted-agents row last, and breaks ties by name", () => {
    const rows = [
      row({ id: null, name: "Deleted agents", runs: 999 }),
      row({ name: "Zed", runs: 5 }),
      row({ name: "Abe", runs: 5 }),
    ];
    expect(names(sortAgentRows(rows, "runs", "desc"))).toEqual(["Abe", "Zed", "Deleted agents"]);
    expect(names(sortAgentRows(rows, "runs", "asc"))).toEqual(["Abe", "Zed", "Deleted agents"]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ name: "B", runs: 1 }), row({ name: "A", runs: 2 })];
    const copy = [...rows];
    sortAgentRows(rows, "runs", "desc");
    expect(rows).toEqual(copy);
  });
});

describe("acceptTrend", () => {
  const cur = { accepted: 78, resolved: 100 }; // 78%

  it("is up when the rate rose by at least 1 point, with the previous fraction", () => {
    expect(acceptTrend({ accept: cur, previousAccept: { accepted: 36, resolved: 50 } })).toEqual({
      kind: "up",
      was: { accepted: 36, resolved: 50 },
    });
  });

  it("is down when it fell by at least 1 point", () => {
    expect(acceptTrend({ accept: { accepted: 64, resolved: 100 }, previousAccept: { accepted: 35, resolved: 50 } }).kind).toBe("down");
  });

  it("shows no arrow for a change under 1 point", () => {
    const t = acceptTrend({ accept: { accepted: 78, resolved: 100 }, previousAccept: { accepted: 389, resolved: 500 } }); // 77.8%
    expect(t).toMatchObject({ kind: "none", reason: "flat" });
  });

  it("explains a missing arrow: no history, too few previous decisions, nothing decided now", () => {
    expect(acceptTrend({ accept: cur, previousAccept: null })).toEqual({ kind: "none", reason: "noHistory" });
    expect(acceptTrend({ accept: cur, previousAccept: { accepted: 2, resolved: 3 } })).toMatchObject({ kind: "none", reason: "fewDecisions" });
    expect(acceptTrend({ accept: { accepted: 0, resolved: 0 }, previousAccept: { accepted: 36, resolved: 50 } })).toMatchObject({
      kind: "none",
      reason: "noCurrent",
    });
  });

  it("still gives an arrow from a partially covered previous window with at least 5 decisions", () => {
    expect(acceptTrend({ accept: cur, previousAccept: { accepted: 3, resolved: 5 } }).kind).toBe("up");
  });

  it("acceptPct is null with no decisions, never 0", () => {
    expect(acceptPct({ accept: { accepted: 0, resolved: 0 } })).toBeNull();
    expect(acceptPct({ accept: { accepted: 1, resolved: 4 } })).toBe(25);
  });
});
