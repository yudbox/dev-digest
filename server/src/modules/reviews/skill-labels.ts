import { skillLabel } from "@devdigest/reviewer-core";

/**
 * Skill attribution. The prompt labels the skills it loaded `[S1]…[Sn]`
 * (reviewer-core's `skillLabel`); the model reports, in `skills_applied` and
 * per-finding `rule_refs`, which labels it used. The model's answer is DATA, not
 * trusted: a label is accepted only if it maps to a skill that was loaded in
 * this run, and what is stored is the skill id — never the label.
 */

export interface LoadedSkill {
  skillId: string;
  version: number;
}

export type SkillLabelMap = Map<string, LoadedSkill>;

/** Labels for the skills in the SAME order they were passed to the prompt. */
export function buildSkillLabelMap(loaded: LoadedSkill[]): SkillLabelMap {
  return new Map(loaded.map((s, i) => [skillLabel(i), s]));
}

/** "s1", " [S1] " → "S1". */
const normalize = (label: string): string => label.trim().replace(/^\[|\]$/g, "").toUpperCase();

function toIds(map: SkillLabelMap, labels: string[] | null | undefined): string[] {
  const ids = new Set<string>();
  for (const raw of labels ?? []) {
    const hit = map.get(normalize(raw));
    if (hit) ids.add(hit.skillId); // unknown labels (hallucinations) are dropped
  }
  return [...ids];
}

/** Skill ids the model reported as applied. null/absent → none (all "not applied"). */
export function mapAppliedLabels(
  map: SkillLabelMap,
  labels: string[] | null | undefined,
): Set<string> {
  return new Set(toIds(map, labels));
}

/** Skill ids behind one finding; null when it cites none (or none valid). */
export function mapRuleRefs(
  map: SkillLabelMap,
  labels: string[] | null | undefined,
): string[] | null {
  const ids = toIds(map, labels);
  return ids.length > 0 ? ids : null;
}

export interface RunSkillRecord {
  skillId: string;
  skillVersion: number;
  applied: boolean;
  findingsCited: number;
}

/**
 * One record per skill that was loaded into the prompt. `findingsCited` counts
 * only the findings that were actually saved (they survived grounding).
 */
export function buildRunSkillRecords(
  loaded: LoadedSkill[],
  appliedIds: Set<string>,
  savedFindingRefs: (string[] | null)[],
): RunSkillRecord[] {
  return loaded.map((s) => ({
    skillId: s.skillId,
    skillVersion: s.version,
    applied: appliedIds.has(s.skillId),
    findingsCited: savedFindingRefs.filter((refs) => refs?.includes(s.skillId)).length,
  }));
}
