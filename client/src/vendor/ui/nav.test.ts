import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

describe("sidebar nav", () => {
  const global = NAV.find((g) => g.section === "GLOBAL")!;

  it("orders GLOBAL as Memory → Multi-Agent Review → Agent Performance → CI Runs", () => {
    expect(global.items.map((i) => i.label)).toEqual([
      "Memory",
      "Multi-Agent Review",
      "Agent Performance",
      "CI Runs",
    ]);
  });

  it("links Agent Performance to the workspace-level route (no repo scope)", () => {
    const item = global.items.find((i) => i.key === "agent-performance")!;
    expect(item.href).toBe("/agent-performance");
    expect(item.href).not.toContain(":repoId");
  });

  it("keeps every g-shortcut unique", () => {
    const keys = NAV.flatMap((g) => g.items.map((i) => i.gKey)).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
