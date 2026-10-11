import { describe, it, expect } from "vitest";
import type { AgentPerfRow } from "@devdigest/shared";
import {
  EMPTY_AGGREGATE,
  avgCostDelta,
  collapseSegments,
  costSourceBadge,
  mergeAggregates,
  pickMostActive,
  toAgentRow,
  toCategoryCounts,
  toSeverityBuckets,
  totalCostDelta,
  type AgentAggregate,
  type SegmentInput,
} from "./helpers.js";

const agg = (over: Partial<AgentAggregate> = {}): AgentAggregate => ({ ...EMPTY_AGGREGATE, ...over });

describe("costSourceBadge", () => {
  it("is billed / estimated / mixed over runs with a recorded source, null otherwise", () => {
    expect(costSourceBadge(3, 0)).toBe("billed");
    expect(costSourceBadge(0, 2)).toBe("estimated");
    expect(costSourceBadge(1, 1)).toBe("mixed");
    expect(costSourceBadge(0, 0)).toBeNull();
  });
});

describe("toAgentRow", () => {
  const id = { id: "a1", name: "Alpha", enabled: true };

  it("averages cost over costed runs only and duration over runs with a duration", () => {
    const row = toAgentRow(
      id,
      agg({ runs: 3, totalCostUsd: 0.3, costedRuns: 2, durationRuns: 2, durationSumMs: 3000, accepted: 4, resolved: 5 }),
      undefined,
      [],
    );
    expect(row.avgCostUsd).toBeCloseTo(0.15, 9);
    expect(row.runsWithoutCost).toBe(1);
    expect(row.avgDurationMs).toBe(1500);
    expect(row.accept).toEqual({ accepted: 4, resolved: 5 });
  });

  it("an agent with no runs has null averages, never zeros", () => {
    const row = toAgentRow(id, EMPTY_AGGREGATE, undefined, []);
    expect(row.runs).toBe(0);
    expect(row.avgCostUsd).toBeNull();
    expect(row.avgDurationMs).toBeNull();
    expect(row.lastRunAt).toBeNull();
    expect(row.costSource).toBeNull();
  });

  it("previousAccept is null with no history and a fraction otherwise", () => {
    expect(toAgentRow(id, agg({ runs: 1 }), undefined, []).previousAccept).toBeNull();
    expect(toAgentRow(id, agg({ runs: 1 }), agg(), []).previousAccept).toBeNull();
    expect(
      toAgentRow(id, agg({ runs: 1 }), agg({ runs: 4, accepted: 36, resolved: 50 }), []).previousAccept,
    ).toEqual({ accepted: 36, resolved: 50 });
  });
});

describe("mergeAggregates", () => {
  it("sums counts and keeps the later last run", () => {
    const a = agg({ runs: 1, totalCostUsd: 0.1, lastRunAt: new Date("2026-10-01T00:00:00Z"), accepted: 1, resolved: 2 });
    const b = agg({ runs: 2, totalCostUsd: 0.2, lastRunAt: new Date("2026-10-05T00:00:00Z"), accepted: 3, resolved: 3 });
    const m = mergeAggregates(a, b);
    expect(m.runs).toBe(3);
    expect(m.totalCostUsd).toBeCloseTo(0.3, 9);
    expect(m.lastRunAt?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(m.accepted).toBe(4);
    expect(mergeAggregates(a, EMPTY_AGGREGATE).lastRunAt).toEqual(a.lastRunAt);
  });
});

describe("pickMostActive", () => {
  const base = toAgentRow({ id: "x", name: "X", enabled: true }, EMPTY_AGGREGATE, undefined, []);
  const row = (over: Partial<AgentPerfRow>): AgentPerfRow => ({ ...base, ...over });

  it("picks the agent with the most runs", () => {
    const top = pickMostActive([
      row({ id: "a", name: "A", runs: 5 }),
      row({ id: "b", name: "B", runs: 9 }),
    ]);
    expect(top?.id).toBe("b");
  });

  it("breaks a tie by the later last run, then by name", () => {
    const byRecency = pickMostActive([
      row({ id: "a", name: "A", runs: 4, lastRunAt: "2026-10-01T00:00:00.000Z" }),
      row({ id: "b", name: "B", runs: 4, lastRunAt: "2026-10-09T00:00:00.000Z" }),
    ]);
    expect(byRecency?.id).toBe("b");

    const byName = pickMostActive([
      row({ id: "z", name: "Zeta", runs: 4, lastRunAt: "2026-10-09T00:00:00.000Z" }),
      row({ id: "a", name: "Alpha", runs: 4, lastRunAt: "2026-10-09T00:00:00.000Z" }),
    ]);
    expect(byName?.id).toBe("a");
  });

  it("never picks the Deleted-agents row or an agent without runs", () => {
    expect(
      pickMostActive([
        row({ id: null, name: "Deleted agents", runs: 99 }),
        row({ id: "a", name: "A", runs: 1 }),
      ])?.id,
    ).toBe("a");
    expect(pickMostActive([row({ id: "a", name: "A", runs: 0 })])).toBeNull();
    expect(pickMostActive([])).toBeNull();
  });
});

describe("cost deltas", () => {
  const firstRun = new Date("2026-08-01T00:00:00Z");
  const prevFrom = new Date("2026-08-12T00:00:00Z");

  it("total cost delta needs the previous window fully covered by history", () => {
    expect(totalCostDelta(10, 7, firstRun, prevFrom)).toBe(3);
    expect(totalCostDelta(10, 7, new Date("2026-09-01T00:00:00Z"), prevFrom)).toBeNull();
    expect(totalCostDelta(10, 7, null, prevFrom)).toBeNull();
  });

  it("avg cost delta needs at least 5 costed runs in the previous window", () => {
    expect(avgCostDelta(0.04, { totalCostUsd: 0.25, costedRuns: 5 })).toBeCloseTo(-0.01, 9);
    expect(avgCostDelta(0.04, { totalCostUsd: 0.2, costedRuns: 4 })).toBeNull();
    expect(avgCostDelta(null, { totalCostUsd: 1, costedRuns: 10 })).toBeNull();
  });
});

describe("collapseSegments", () => {
  const groups = (n: number): SegmentInput[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `m${i}`,
      label: `model-${i}`,
      costUsd: n - i,
      kind: "model" as const,
    }));
  const total = (xs: { costUsd: number }[]) => xs.reduce((s, x) => s + x.costUsd, 0);

  it("shows everything, ordered by cost, when there are at most 7 groups", () => {
    const out = collapseSegments(groups(7), "models");
    expect(out).toHaveLength(7);
    expect(out.some((s) => s.kind === "other")).toBe(false);
    expect(out.map((s) => s.costUsd)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it("folds the tail into one Other so there are 7 segments and the sum is preserved", () => {
    const input = groups(9);
    const out = collapseSegments(input, "models");
    expect(out).toHaveLength(7);
    const other = out[6]!;
    expect(other.kind).toBe("other");
    expect(other.label).toBe("Other (3 models)");
    expect(other.hidden).toHaveLength(3);
    expect(total(out)).toBeCloseTo(total(input), 9);
  });

  it("drops $0 groups", () => {
    const out = collapseSegments(
      [
        { key: "a", label: "A", costUsd: 1, kind: "agent" },
        { key: "b", label: "B", costUsd: 0, kind: "agent" },
      ],
      "agents",
    );
    expect(out.map((s) => s.label)).toEqual(["A"]);
  });
});

describe("chart shaping", () => {
  it("toCategoryCounts always returns the five categories in order, zero-filled", () => {
    const out = toCategoryCounts([
      { category: "bug", n: 3 },
      { category: "security", n: 7 },
    ]);
    expect(out.map((c) => c.category)).toEqual(["security", "bug", "perf", "style", "test"]);
    expect(out.map((c) => c.count)).toEqual([7, 3, 0, 0, 0]);
  });

  it("toSeverityBuckets zero-fills buckets that have no findings", () => {
    const buckets = [
      { label: "W1", start: "a", end: "b", partial: false },
      { label: "W2", start: "b", end: "c", partial: true },
    ];
    const out = toSeverityBuckets(buckets, [{ idx: 1, severity: "WARNING", n: 4 }]);
    expect(out[0]).toMatchObject({ label: "W1", critical: 0, warning: 0, suggestion: 0 });
    expect(out[1]).toMatchObject({ label: "W2", warning: 4, partial: true });
  });
});
