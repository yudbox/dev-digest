import { z } from "zod";

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum([
  "implemented",
  "missing",
  "out_of_scope",
]);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const DiagramNode = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["file", "package", "service"]),
  isOverflow: z.boolean().optional(),
  detail: z.string().optional(), // mermaid for drill-down
});
export type DiagramNode = z.infer<typeof DiagramNode>;

export const DiagramEdge = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});
export type DiagramEdge = z.infer<typeof DiagramEdge>;

export const ArchitectureSection = z.object({
  overview: z.string(),
  style: z.string(),
  nodes: z.array(DiagramNode),
  edges: z.array(DiagramEdge),
});
export type ArchitectureSection = z.infer<typeof ArchitectureSection>;

export const CriticalPathItem = z.object({
  file: z.string(),
  whyItMatters: z.string(),
  openUrl: z.string(),
});
export type CriticalPathItem = z.infer<typeof CriticalPathItem>;

export const HowToRunSection = z.object({
  packageManager: z.string(),
  commands: z.array(z.string()),
  envVars: z.array(z.string()),
  entrypoint: z.string(),
});
export type HowToRunSection = z.infer<typeof HowToRunSection>;

export const ReadingPathItem = z.object({
  order: z.number(),
  file: z.string(),
  reason: z.string(),
  openUrl: z.string(),
});
export type ReadingPathItem = z.infer<typeof ReadingPathItem>;

export const GapType = z.enum(["missing-test", "missing-doc", "missing-pattern"]);
export type GapType = z.infer<typeof GapType>;

export const Complexity = z.enum(["Low", "Medium", "High"]);
export type Complexity = z.infer<typeof Complexity>;

export const FirstTask = z.object({
  title: z.string(),
  suggestedPath: z.string(),
  gapType: GapType,
  rationale: z.string(),
  patternPointer: z.string(),
  complexity: Complexity,
  verificationHint: z.string(),
  packageId: z.string().optional(),
});
export type FirstTask = z.infer<typeof FirstTask>;

export const OnboardingSections = z.object({
  architecture: ArchitectureSection,
  criticalPaths: z.array(CriticalPathItem),
  howToRun: HowToRunSection,
  readingPath: z.array(ReadingPathItem),
  firstTasks: z.array(FirstTask),
});
export type OnboardingSections = z.infer<typeof OnboardingSections>;

export const Onboarding = z.object({
  repoName: z.string(),
  filesIndexed: z.number(),
  generatedAt: z.string(), // ISO date string
  headSha: z.string(),
  narrativeUnavailable: z.boolean().optional(),
  sections: OnboardingSections,
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(["skill", "agent"]);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(["repo", "global", "team"]);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  "decision",
  "convention",
  "preference",
  "fact",
  "learning",
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(["rubric", "convention", "security", "custom"]);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum([
  "manual",
  "imported_url",
  "extracted",
  "community",
]);
export type SkillSource = z.infer<typeof SkillSource>;

export const SkillThreatLevel = z.enum([
  "unknown",
  "safe",
  "suspicious",
  "dangerous",
]);
export type SkillThreatLevel = z.infer<typeof SkillThreatLevel>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number(),
  evidence_files: z.array(z.string()).nullable(),
  threat_level: SkillThreatLevel.optional(),
  /** Ordered list of project-context doc paths attached to this skill. */
  context_doc_paths: z.array(z.string()).default([]),
  // Bonus list-stats (AC-31) — additive-optional.
  agent_count: z.number().int().optional(),
  pull_frequency_pct: z.number().optional(),
  accept_rate_pct: z.number().optional(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(["openai", "anthropic", "openrouter"]);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(["single-pass", "map-reduce", "auto"]);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(["never", "critical", "warning", "any"]);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default("single-pass"),
  ci_fail_on: CiFailOn.default("critical"),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  skill_count: z.number().int().optional(),
  // When set, provider+model come from Settings → Feature Models (single source of truth).
  feature_model_id: z.string().nullish(),
  /** Ordered list of project-context doc paths attached to this agent. */
  context_doc_paths: z.array(z.string()).default([]),
  // Bonus list-stats (AC-30) — additive-optional, same pattern as skill_count,
  // so no existing fixture breaks.
  runs_count: z.number().int().optional(),
  accept_rate_pct: z.number().optional(),
  avg_cost_usd: z.number().nullish(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

/**
 * One historical `agent_versions` snapshot — mirrors `GET /skills/:id/versions`'s
 * existing pattern (Q9). Used by `CompareRunsModal`'s prompt diff (AC-20): the
 * old `system_prompt` text for a given `agent_version` isn't exposed anywhere
 * else.
 */
export const AgentVersionSummary = z.object({
  version: z.number().int(),
  system_prompt: z.string(),
  created_at: z.string(),
});
export type AgentVersionSummary = z.infer<typeof AgentVersionSummary>;
