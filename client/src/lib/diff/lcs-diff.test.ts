import { describe, it, expect } from "vitest";
import { parsePatch } from "@/components/diff-viewer/helpers";
import { diffLines, buildPromptDiffPatch } from "./lcs-diff";

describe("diffLines", () => {
  it("marks unchanged lines as equal and changed lines as add/del", () => {
    const ops = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    expect(ops).toEqual([
      { type: "equal", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "equal", text: "c" },
    ]);
  });
});

describe("buildPromptDiffPatch + parsePatch integration (AC-20)", () => {
  it("produces a patch parsePatch() renders with add/del/ctx line kinds", () => {
    const patch = buildPromptDiffPatch(
      "You are a reviewer.\nBe concise.",
      "You are a strict reviewer.\nBe concise.",
    );
    const lines = parsePatch(patch);
    expect(lines[0]!.kind).toBe("hunk");
    const kinds = lines.slice(1).map((l) => l.kind);
    expect(kinds).toContain("del");
    expect(kinds).toContain("add");
    expect(kinds).toContain("ctx");
  });
});
