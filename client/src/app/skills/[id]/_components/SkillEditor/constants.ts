export const TABS = ["config", "preview", "stats", "versions", "context", "evals"] as const;
export type SkillEditorTab = (typeof TABS)[number];
