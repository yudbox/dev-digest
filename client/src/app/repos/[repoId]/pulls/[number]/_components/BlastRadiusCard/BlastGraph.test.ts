import { describe, expect, it } from "vitest";
import type { BlastRadiusResult } from "@devdigest/shared";
import { buildLayeredGraph } from "./BlastGraph";

const base: BlastRadiusResult = {
  changedSymbols: [
    { file: "src/nav.tsx", name: "AdminNav", kind: "function" },
    { file: "src/repo.ts", name: "countTotal", kind: "method" },
  ],
  callers: [
    { file: "src/service.ts", symbol: "getStats", viaSymbol: "countTotal", line: 69, rank: 2 },
    { file: "src/service.ts", symbol: "getTotals", viaSymbol: "countTotal", line: 164, rank: 1 },
    { file: "src/jobs.ts", symbol: "nightly", viaSymbol: "countTotal", line: 10, rank: 1 },
  ],
  impactedEndpoints: ["GET /api/stats"],
  factsByFile: {
    "src/service.ts": { endpoints: ["GET /api/stats"], crons: [] },
    "src/jobs.ts": { endpoints: [], crons: ["0 3 * * *"] },
  },
};

const ids = (nodes: { id: string }[]) => nodes.map((n) => n.id);

describe("buildLayeredGraph", () => {
  it("puts each kind in its own column", () => {
    const { columns } = buildLayeredGraph(base);
    expect(columns.symbol).toHaveLength(2);
    expect(columns.caller).toHaveLength(3);
    expect(ids(columns.endpoint)).toEqual(["ep:GET /api/stats"]);
    expect(ids(columns.cron)).toEqual(["cron:0 3 * * *"]);
  });

  it("links symbol → caller → endpoint/cron through the caller's file facts", () => {
    const { links } = buildLayeredGraph(base);
    const pairs = links.map((l) => `${l.source} > ${l.target}`);
    expect(pairs).toContain("sym:countTotal > caller:src/service.ts:69");
    expect(pairs).toContain("caller:src/service.ts:69 > ep:GET /api/stats");
    expect(pairs).toContain("caller:src/service.ts:164 > ep:GET /api/stats");
    expect(pairs).toContain("caller:src/jobs.ts:10 > cron:0 3 * * *");
    expect(pairs.filter((p) => p.startsWith("sym:AdminNav"))).toHaveLength(0);
  });

  it("orders symbols with callers above the ones nobody calls", () => {
    const { columns } = buildLayeredGraph(base);
    expect(ids(columns.symbol)).toEqual(["sym:countTotal", "sym:AdminNav"]);
  });

  it("labels callers by enclosing symbol with file:line as detail", () => {
    const caller = buildLayeredGraph(base).columns.caller.find(
      (n) => n.id === "caller:src/service.ts:69",
    );
    expect(caller?.label).toBe("getStats");
    expect(caller?.detail).toBe("service.ts:69");
  });

  it("keeps endpoints without factsByFile as unlinked nodes", () => {
    const { columns, links } = buildLayeredGraph({ ...base, factsByFile: undefined });
    expect(ids(columns.endpoint)).toEqual(["ep:GET /api/stats"]);
    expect(columns.cron).toHaveLength(0);
    expect(links.some((l) => l.target.startsWith("ep:"))).toBe(false);
  });
});
