/**
 * Bundle assembler — collects all CI files into a CiFile[] array.
 *
 * Reads the pre-built agent-runner bundle from disk; throws a descriptive
 * error if the dist bundle is absent (AC-2: never child_process-build).
 */
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { CiFile } from "@devdigest/shared";
import { agentYaml } from "./manifest.js";
import { workflowYml } from "./workflow.js";
import { kebabSlug, dedupeSlugs } from "./slug.js";

/**
 * Repo root resolved from an env var (production) or by walking up from
 * process.cwd() (development). Never use __dirname / import.meta.url
 * relative traversal — that breaks when the bundle is compiled or deployed.
 *
 * In production set DEVDIGEST_REPO_ROOT=/app (or wherever the monorepo lives).
 * In development cwd() is the server/ dir, so one level up is the repo root.
 */
const REPO_ROOT = process.env.DEVDIGEST_REPO_ROOT
  ? resolve(process.env.DEVDIGEST_REPO_ROOT)
  : resolve(process.cwd(), "..");

const RUNNER_DIST = join(REPO_ROOT, "agent-runner", "dist", "index.js");

export interface AssembleOptions {
  agent: {
    id: string;
    name: string;
    provider: string;
    model: string;
    systemPrompt: string;
    strategy: string;
    ciFailOn: string;
  };
  skills: Array<{
    id: string;
    name: string;
    body: string;
  }>;
  workflow: {
    triggers: string[];
    postAs: "github_review" | "pr_comment" | "none";
  };
  /** Optional memory snapshot content; defaults to empty (SPEC 3 enriches). */
  memoryContent?: string;
}

/**
 * Assemble all CI files for export.
 *
 * - `editable: false` for all generated files except workflow.yml.
 * - Runner bundle at `.devdigest/runner/index.js` (committed to repo, not installed).
 * - `memory.jsonl` stub (SPEC 3 adds real content).
 *
 * @throws Error with build advice if agent-runner dist is absent.
 */
export function assembleFiles(opts: AssembleOptions): CiFile[] {
  const { agent, skills, workflow, memoryContent = "" } = opts;

  // 1. Read runner bundle (fail clearly if not built)
  let runnerBundle: string;
  try {
    runnerBundle = readFileSync(RUNNER_DIST, "utf-8");
  } catch {
    throw new Error(
      `agent-runner/dist/index.js not found at ${RUNNER_DIST}. ` +
        `Build it first: pnpm --dir agent-runner build`,
    );
  }

  // 2. Compute skill slugs (collision-deduplicated)
  const skillNames = skills.map((s) => s.name);
  const skillSlugs = dedupeSlugs(skillNames);
  const agentSlug = kebabSlug(agent.name);

  // 3. Manifest
  const manifestContents = agentYaml({
    name: agent.name,
    provider: agent.provider as "openai" | "anthropic" | "openrouter",
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: agent.strategy as "auto" | "single-pass" | "map-reduce",
    ci_fail_on: agent.ciFailOn as "never" | "critical" | "warning" | "any",
  });

  // 4. Skill docs
  const skillFiles: CiFile[] = skills.map((skill, i) => ({
    path: `.devdigest/skills/${skillSlugs[i]!}.md`,
    contents: skill.body,
    editable: false,
  }));

  // 5. Workflow YAML (editable: true — the one file the user may edit)
  const workflowContents = workflowYml({
    triggers: workflow.triggers,
    postAs: workflow.postAs,
  });

  const files: CiFile[] = [
    {
      path: `.devdigest/agents/${agentSlug}.yaml`,
      contents: manifestContents,
      editable: false,
    },
    ...skillFiles,
    {
      path: ".devdigest/memory.jsonl",
      contents: memoryContent,
      editable: false,
    },
    {
      path: ".devdigest/runner/index.js",
      contents: runnerBundle,
      editable: false,
    },
    {
      path: ".github/workflows/devdigest-review.yml",
      contents: workflowContents,
      editable: true,
    },
  ];

  return files;
}
