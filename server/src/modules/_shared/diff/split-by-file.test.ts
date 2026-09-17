import { describe, it, expect } from "vitest";
import { splitUnifiedDiffByFile } from "./split-by-file.js";

const TWO_FILE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " unchanged",
  "+added line",
  " context",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 333..444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -5,1 +5,1 @@",
  "-removed",
  "+replaced",
  "",
].join("\n");

describe("splitUnifiedDiffByFile (AC-007-5)", () => {
  it("splits a multi-file diff into one patch per path", () => {
    const map = splitUnifiedDiffByFile(TWO_FILE_DIFF);
    expect([...map.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("each patch starts with @@ and contains no diff --git line", () => {
    const map = splitUnifiedDiffByFile(TWO_FILE_DIFF);
    for (const patch of map.values()) {
      expect(patch.startsWith("@@")).toBe(true);
      expect(patch).not.toContain("diff --git");
      expect(patch).not.toContain("--- a/");
      expect(patch).not.toContain("+++ b/");
    }
  });

  it("does not inflate the last hunk with a trailing empty line from a trailing newline", () => {
    const map = splitUnifiedDiffByFile(TWO_FILE_DIFF);
    const bPatch = map.get("src/b.ts")!;
    expect(bPatch.split("\n")).toEqual(["@@ -5,1 +5,1 @@", "-removed", "+replaced"]);
  });

  it("concatenates multiple hunks of the same file into one patch", () => {
    const raw = [
      "diff --git a/src/multi.ts b/src/multi.ts",
      "--- a/src/multi.ts",
      "+++ b/src/multi.ts",
      "@@ -1,1 +1,1 @@",
      "-old1",
      "+new1",
      "@@ -20,1 +20,1 @@",
      "-old2",
      "+new2",
      "",
    ].join("\n");
    const map = splitUnifiedDiffByFile(raw);
    expect(map.size).toBe(1);
    const patch = map.get("src/multi.ts")!;
    expect(patch).toContain("@@ -1,1 +1,1 @@");
    expect(patch).toContain("@@ -20,1 +20,1 @@");
  });

  it("skips binary files with no +++ / @@ lines (no entry produced)", () => {
    const raw = ["diff --git a/img.png b/img.png", "Binary files a/img.png and b/img.png differ", ""].join("\n");
    const map = splitUnifiedDiffByFile(raw);
    expect(map.size).toBe(0);
  });

  it("returns an empty map for an empty diff", () => {
    expect(splitUnifiedDiffByFile("").size).toBe(0);
  });
});
