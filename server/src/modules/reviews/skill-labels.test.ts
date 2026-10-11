import { describe, it, expect } from "vitest";
import {
  buildRunSkillRecords,
  buildSkillLabelMap,
  mapAppliedLabels,
  mapRuleRefs,
} from "./skill-labels.js";

const loaded = [
  { skillId: "sk-1", version: 3 },
  { skillId: "sk-2", version: 1 },
  { skillId: "sk-3", version: 7 },
];

describe("skill labels", () => {
  const map = buildSkillLabelMap(loaded);

  it("labels skills S1…Sn in the order they were loaded", () => {
    expect([...map.keys()]).toEqual(["S1", "S2", "S3"]);
    expect(map.get("S2")).toEqual({ skillId: "sk-2", version: 1 });
  });

  it("maps applied labels to ids and drops labels that do not exist (hallucinations)", () => {
    expect([...mapAppliedLabels(map, ["S1", "S9"])]).toEqual(["sk-1"]);
    expect([...mapAppliedLabels(map, ["S1", "S3", "S1"])].sort()).toEqual(["sk-1", "sk-3"]);
  });

  it("is lenient about case and brackets, strict about everything else", () => {
    expect([...mapAppliedLabels(map, ["s2", " [S3] ", "S 1", "skill-1", ""])].sort()).toEqual(["sk-2", "sk-3"]);
  });

  it("a missing applied list means nothing was applied", () => {
    expect(mapAppliedLabels(map, null).size).toBe(0);
    expect(mapAppliedLabels(map, undefined).size).toBe(0);
    expect(mapAppliedLabels(map, []).size).toBe(0);
  });

  it("a finding's rule refs become skill ids, or null when it cites no valid skill", () => {
    expect(mapRuleRefs(map, ["S1", "S3"])).toEqual(["sk-1", "sk-3"]);
    expect(mapRuleRefs(map, ["S1", "S1"])).toEqual(["sk-1"]); // de-duplicated
    expect(mapRuleRefs(map, ["S9"])).toBeNull();
    expect(mapRuleRefs(map, [])).toBeNull();
    expect(mapRuleRefs(map, undefined)).toBeNull();
  });

  it("never stores a label: only ids come out", () => {
    for (const ids of [mapRuleRefs(map, ["S1", "S2"]), [...mapAppliedLabels(map, ["S1"])]]) {
      expect(ids!.every((id) => id.startsWith("sk-"))).toBe(true);
    }
  });

  it("an empty skill set has no labels, so every reported label is dropped", () => {
    const none = buildSkillLabelMap([]);
    expect(none.size).toBe(0);
    expect(mapRuleRefs(none, ["S1"])).toBeNull();
  });
});

describe("buildRunSkillRecords", () => {
  it("emits one record per LOADED skill with version, applied flag and saved-finding citations", () => {
    const records = buildRunSkillRecords(loaded, new Set(["sk-1"]), [["sk-1"], ["sk-1", "sk-3"], null]);
    expect(records).toEqual([
      { skillId: "sk-1", skillVersion: 3, applied: true, findingsCited: 2 },
      { skillId: "sk-2", skillVersion: 1, applied: false, findingsCited: 0 },
      { skillId: "sk-3", skillVersion: 7, applied: false, findingsCited: 1 },
    ]);
  });

  it("returns nothing when no skill was loaded", () => {
    expect(buildRunSkillRecords([], new Set(), [["x"]])).toEqual([]);
  });
});
