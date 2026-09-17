import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Container } from "../../platform/container.js";
import type {
  Onboarding,
  CriticalPathItem,
  ReadingPathItem,
  FirstTask,
  Provider,
  HowToRunSection,
  ArchitectureSection,
  DiagramNode,
} from "@devdigest/shared";
import { Onboarding as OnboardingSchema } from "@devdigest/shared";
import { resolveFeatureModelStrict } from "../settings/feature-models.js";
import { NotFoundError } from "../../platform/errors.js";
import {
  getCachedOnboarding,
  upsertOnboarding,
  withAdvisoryLock,
} from "./repository.js";
import { collectFacts } from "./facts-collector.js";
import { applyGrounding, ensurePackageCoverage } from "./grounding.js";
import {
  BASE_COMPLEXITY,
  COMPLEXITY_BUMP,
  HIGH_FAN_IN_THRESHOLD,
  HOTNESS_DAYS,
  CANDIDATE_MULTIPLIER,
  N_HOTNESS_CANDIDATES,
  STYLE_CHECKLIST,
} from "./constants.js";

const PROMPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../prompts",
);

async function loadSystemPrompt(): Promise<string> {
  return readFile(join(PROMPTS_DIR, "onboarding.system.md"), "utf-8");
}

export class OnboardingService {
  constructor(private readonly container: Container) {}

  async generate(
    workspaceId: string,
    repoId: string,
    force: boolean,
    log: {
      info: (msg: string) => void;
      error?: (msg: string, meta?: unknown) => void;
    },
  ): Promise<Onboarding> {
    return withAdvisoryLock(this.container.db, repoId, async () => {
      // 1. Resolve repo
      const repo = await this.container.reposRepo.getById(workspaceId, repoId);
      if (!repo) throw new NotFoundError("Repo not found");

      // 2. Get current HEAD sha (from index state)
      const indexState = await this.container.repoIntel.getIndexState(repoId);
      const headSha = indexState.lastIndexedSha ?? "unknown";

      // 3. Cache check (inside lock — prevent double generation)
      if (!force) {
        const cached = await getCachedOnboarding(this.container.db, repoId);
        if (cached && cached.headSha === headSha) {
          log.info("Onboarding: cache hit (headSha unchanged)");
          return cached.onboarding;
        }
      }

      // 3b. Degraded/failed index — per-section fallback (AC-21/R22): skip the
      // LLM call entirely (no feature-model required either — the workspace
      // shouldn't be forced to configure one just to see a degraded page).
      // Architecture becomes a bare top-level dir listing (no prose/diagram);
      // criticalPaths/readingPath fall back to an entrypoint heuristic (rank
      // data is empty when the index is degraded); howToRun stays fully
      // mechanical; firstTasks is skipped (no rank data to detect gaps
      // against) — the honest message is `narrativeUnavailable: true`. Never
      // persisted to cache — a re-index naturally supersedes it.
      if (indexState.status === "degraded" || indexState.status === "failed") {
        const clonePath = repo.clonePath ?? "";
        const facts = await collectFacts(clonePath);
        const mechanicalHowToRun: HowToRunSection = {
          packageManager:
            facts.packageManager === "unknown" ? "npm" : facts.packageManager,
          commands: buildRunCommands(facts),
          envVars: facts.envVars,
          entrypoint: facts.entrypoint,
        };
        log.info(
          `Onboarding: index ${indexState.status} — returning degraded skeleton (no LLM call)`,
        );
        return buildDegradedSkeleton({
          repoName: repo.fullName,
          filesIndexed: indexState.filesIndexed,
          headSha,
          clonePath,
          facts,
          mechanicalHowToRun,
        });
      }

      // 4. Resolve LLM — strict: throws ValidationError if no model configured
      const { provider, model } = await resolveFeatureModelStrict(
        this.container,
        workspaceId,
        "onboarding",
      );
      let llm;
      try {
        llm = await this.container.llm(provider as Provider);
      } catch (err) {
        throw new Error(
          `Onboarding: LLM provider "${provider}" not configured — ${(err as Error).message}`,
        );
      }

      // 5. Collect deterministic filesystem facts (no LLM)
      const clonePath = repo.clonePath ?? "";
      const facts = await collectFacts(clonePath);

      // 6. Rank + hotness (top-N candidates only, never whole repo)
      const candidateCount = N_HOTNESS_CANDIDATES * CANDIDATE_MULTIPLIER;
      const topFiles = await this.container.repoIntel
        .getTopFilesByRank(repoId, candidateCount)
        .catch(() => [] as string[]);

      const candidates = topFiles.slice(0, N_HOTNESS_CANDIDATES);

      const fileRankRows = await this.container.repoIntel
        .getFileRank(repoId, candidates)
        .catch(() => [] as { path: string; percentile: number }[]);

      const percentileMap = new Map(
        fileRankRows.map((r) => [r.path, r.percentile]),
      );

      // Hotness from GitHub commit activity — degrades to 0 on error (AC-13)
      let hotnessMap: Record<string, number> = {};
      try {
        const gh = await this.container.vcs(repo);
        hotnessMap = await gh.getCommitActivity(
          {
            owner: repo.owner,
            name: repo.name,
            project: repo.project ?? undefined,
            baseUrl: repo.baseUrl ?? undefined,
          },
          candidates,
          HOTNESS_DAYS,
        );
      } catch {
        log.info(
          "Onboarding: hotness fetch failed — falling back to pure percentile rank",
        );
      }

      // Normalize hotness 0-1 across candidates
      const maxHotness = Math.max(1, ...Object.values(hotnessMap));
      const normalizedHotness = (path: string) =>
        (hotnessMap[path] ?? 0) / maxHotness;

      // combinedRank = percentile × (1 + normalizedHotness)
      const ranked = candidates
        .map((path) => ({
          path,
          score: (percentileMap.get(path) ?? 0) * (1 + normalizedHotness(path)),
        }))
        .sort((a, b) => b.score - a.score);

      const rankedPaths = ranked.map((r) => r.path);

      // 7. Reading-path from critical paths (BFS chains)
      const criticalChains = await this.container.repoIntel
        .getCriticalPaths(repoId)
        .catch(() => [] as string[][]);

      const readingPathFiles = dedupePaths(criticalChains.flat()).slice(0, 10);

      // 8. Doc discovery via ContextService
      const specFiles = await this.container.contextService
        .listDocsForRepo(workspaceId, repoId)
        .catch(() => []);

      const docPaths = new Set(specFiles.map((f) => f.path));

      // 9. Build known-facts set for grounding gate
      const knownFilePaths = new Set([...topFiles, ...readingPathFiles]);
      const packageNames = new Set(
        facts.packages.map((p) => p.name).filter(Boolean) as string[],
      );
      const serviceNames = new Set(facts.dockerServices.map((s) => s.name));

      // 10. Build First Tasks from detected gaps
      const firstTasks = await this.detectFirstTasks(
        facts.packages,
        rankedPaths,
        docPaths,
        knownFilePaths,
        repoId,
        { owner: repo.owner, name: repo.name },
      );

      // 11. Build How To Run mechanically (no LLM needed for this section)
      const mechanicalHowToRun: HowToRunSection = {
        packageManager:
          facts.packageManager === "unknown" ? "npm" : facts.packageManager,
        commands: buildRunCommands(facts),
        envVars: facts.envVars,
        entrypoint: facts.entrypoint,
      };

      // 12. Build prompt
      const rawSystemPrompt = await loadSystemPrompt();
      const systemPrompt = rawSystemPrompt.replace("{{language}}", "English");

      const userContent = buildUserPrompt({
        repoName: repo.fullName,
        rankedPaths: rankedPaths.slice(0, 20),
        readingPathFiles,
        facts,
        criticalChains,
        filesIndexed: indexState.filesIndexed,
        headSha,
        mechanicalHowToRun,
        firstTasks,
      });

      // 13. Exactly ONE structured LLM call for all 5 sections
      let onboarding: Onboarding;
      try {
        const result = await llm.completeStructured({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          schema: OnboardingSchema,
          schemaName: "Onboarding",
        });

        log.info(
          `Onboarding: LLM cost ${((result.costUsd ?? 0) * 100).toFixed(4)}¢`,
        );

        // 14. Apply grounding gate
        const raw = result.data as Onboarding;
        onboarding = applyGrounding(raw, {
          filePaths: knownFilePaths,
          packageNames,
          serviceNames,
        });

        // 14a. Top-level metadata is server-known fact, never the LLM's to
        // decide — the model has no real notion of wall-clock time (or the
        // exact indexed file count/headSha), so echoing its own guess back
        // here produced nonsense like "refreshed 452 days ago" for a
        // just-generated tour. Overwrite unconditionally, same "facts
        // overwrite whatever the LLM echoed" pattern already applied to
        // howToRun/firstTasks/readingPath below.
        onboarding.repoName = repo.fullName;
        onboarding.filesIndexed = indexState.filesIndexed;
        onboarding.generatedAt = new Date().toISOString();
        onboarding.headSha = headSha;

        // 14b. Multi-package repos: reserve at least one Critical Paths slot
        // per detected package (AC-20/R21) — a deterministic supplement, since
        // the LLM's own criticalPaths selection is free-form, not "use as-is".
        onboarding.sections.criticalPaths = ensurePackageCoverage(
          onboarding.sections.criticalPaths,
          facts.packages,
          rankedPaths,
          (file) => `https://github.com/${repo.fullName}/blob/${headSha}/${file}`,
        );

        // 14c. Reading Path mirrors repoIntel.getCriticalPaths' BFS traversal
        // order deterministically (AC-17/R18) — built server-side, not left to
        // the LLM's own judgment (unlike architecture/criticalPaths prose).
        onboarding.sections.readingPath = buildReadingPath(
          readingPathFiles,
          repo.fullName,
          headSha,
        );

        // 14d. How To Run and First Tasks are fully mechanical (R16/R19: gap
        // detectors + complexity mapping are TS constants, never an LLM
        // decision) — overwrite whatever the LLM echoed back with the
        // precomputed values so both sections work identically even in a
        // degraded/0-LLM-call scenario.
        onboarding.sections.howToRun = mechanicalHowToRun;
        onboarding.sections.firstTasks = firstTasks;

        // 14e. Level-2 drill-down sub-diagrams (AC-27) are deterministic
        // sub-diagrams built from real repoIntel facts, never LLM free text —
        // the model has no real view of the file tree/import graph, and
        // leaving `detail` to its own judgment produced blank/invalid modals
        // in practice (either empty, or text mermaid.parse rejects outright).
        // `service`-kind nodes get no detail at all: an external service has
        // no internal file structure to visualize, so an honest "no detail"
        // beats fabricating one.
        onboarding.sections.architecture.nodes = buildNodeDetails(
          onboarding.sections.architecture.nodes,
          facts.packages,
          rankedPaths,
          criticalChains,
        );
      } catch (err) {
        // LLM failed → return deterministic skeleton (AC-22), do NOT write cache
        log.error?.("Onboarding: LLM call failed — returning skeleton", {
          err,
        });
        return buildSkeleton({
          repoName: repo.fullName,
          filesIndexed: indexState.filesIndexed,
          headSha,
          mechanicalHowToRun,
          readingPathFiles,
          rankedPaths,
          firstTasks,
        });
      }

      // 15. Persist
      await upsertOnboarding(this.container.db, repoId, onboarding, headSha);
      return onboarding;
    });
  }

  /**
   * Build First Tasks from three deterministic gap detectors: missing-test,
   * missing-doc (universal, per-package), and missing-pattern (v1
   * style-conditional checklist — health/readiness + rate-limiting for
   * backend packages, error boundary/loading state for frontend packages).
   * Tie-break: round-robin first by gap-type, then by package, so the final
   * 2-3 tasks never collapse into three of the same type or the same package
   * (AC-16/R19).
   */
  private async detectFirstTasks(
    packages: Awaited<ReturnType<typeof collectFacts>>["packages"],
    rankedPaths: string[],
    docPaths: Set<string>,
    knownFilePaths: Set<string>,
    repoId: string,
    repoRef: { owner: string; name: string },
  ): Promise<FirstTask[]> {
    const buckets: Record<FirstTask["gapType"], FirstTask[]> = {
      "missing-test": [],
      "missing-doc": [],
      "missing-pattern": [],
    };

    for (const pkg of packages) {
      // missing-doc gap: a ranked top file with no corresponding doc
      const topFileForPkg = rankedPaths.find(
        (p) =>
          p.startsWith(pkg.dir.split("/").pop() ?? "") ||
          p.includes(pkg.relativePath.replace("/package.json", "")),
      );
      if (topFileForPkg && !docPaths.has(topFileForPkg)) {
        const fanIn = await this.getFanIn(repoId, topFileForPkg);
        const base = BASE_COMPLEXITY["missing-doc"];
        buckets["missing-doc"].push({
          title: `Add README for ${pkg.name ?? "package"}`,
          suggestedPath: topFileForPkg.replace(/\.[^.]+$/, ".md"),
          gapType: "missing-doc",
          rationale: `No documentation found for ${topFileForPkg}`,
          patternPointer: topFileForPkg,
          complexity:
            fanIn >= HIGH_FAN_IN_THRESHOLD ? COMPLEXITY_BUMP[base] : base,
          verificationHint:
            "Verify the README covers setup, key concepts, and main entry points",
          packageId: pkg.name,
        });
      }

      // missing-test gap: a ranked top file with no sibling .test.ts
      const untestedFile = rankedPaths.find((p) => {
        if (!p.match(/\.(ts|tsx|js|jsx)$/)) return false;
        if (p.includes(".test.") || p.includes(".spec.")) return false;
        const testPath = p.replace(/\.(ts|tsx|js|jsx)$/, ".test.ts");
        return !knownFilePaths.has(testPath);
      });
      if (untestedFile) {
        const fanIn = await this.getFanIn(repoId, untestedFile);
        const base = BASE_COMPLEXITY["missing-test"];
        buckets["missing-test"].push({
          title: `Add unit tests for ${untestedFile.split("/").pop()}`,
          suggestedPath: untestedFile.replace(/\.(ts|tsx|js|jsx)$/, ".test.ts"),
          gapType: "missing-test",
          rationale: `High-ranked file ${untestedFile} has no test coverage`,
          patternPointer: untestedFile,
          complexity:
            fanIn >= HIGH_FAN_IN_THRESHOLD ? COMPLEXITY_BUMP[base] : base,
          verificationHint:
            "Run vitest and confirm the new test file passes with ≥ 80% branch coverage",
          packageId: pkg.name,
        });
      }
    }

    // missing-pattern gap: v1 3-item style-conditional checklist. One
    // candidate per checklist entry whose marker is absent repo-wide,
    // scoped to the first matching package.
    for (const check of STYLE_CHECKLIST) {
      const matchingPkg = packages.find(
        (p) => check.role === "any" || p.role === check.role,
      );
      if (!matchingPkg) continue;

      const found = await this.container.codeIndex
        .grep(repoRef, check.markerPattern)
        .catch(() => []);
      if (found.length > 0) continue; // pattern already present — not a gap

      const pkgDir = matchingPkg.relativePath.replace(/\/package\.json$/, "");
      buckets["missing-pattern"].push({
        title: `Add ${check.patternName}`,
        suggestedPath: pkgDir
          ? `${pkgDir}/${check.suggestedPathTemplate}`
          : check.suggestedPathTemplate,
        gapType: "missing-pattern",
        rationale: `No ${check.patternName} detected for the ${matchingPkg.role} package`,
        patternPointer: check.patternPointerHint,
        complexity: BASE_COMPLEXITY["missing-pattern"],
        verificationHint: `Verify ${check.patternName} is reachable and functioning`,
        packageId: matchingPkg.name,
      });
    }

    // Round-robin: one pick per gap-type per round, cycling until 3 tasks are
    // selected or every bucket is exhausted. Within a round, prefer a task
    // whose package isn't represented in `selected` yet (AC-18/R21 — a
    // multi-package repo must not have its 2-3 First Tasks collapse onto a
    // single package, mirroring ensurePackageCoverage's guarantee for
    // Critical Paths); fall back to plain FIFO once every remaining
    // candidate's package is already represented.
    const order: FirstTask["gapType"][] = [
      "missing-test",
      "missing-doc",
      "missing-pattern",
    ];
    const selected: FirstTask[] = [];
    let round = 0;
    while (
      selected.length < 3 &&
      order.some((type) => buckets[type].length > 0)
    ) {
      const type = order[round % order.length]!;
      const next = pickPreferringNewPackage(buckets[type], selected);
      if (next) selected.push(next);
      round++;
    }

    return selected;
  }

  /** Fan-in proxy: number of call-sites referencing `file`'s exported symbols. */
  private async getFanIn(repoId: string, file: string): Promise<number> {
    try {
      const rows = await this.container.repoIntel.getCallerSignatures(
        repoId,
        [file],
        100,
      );
      return rows.length;
    } catch {
      return 0;
    }
  }
}

// ---- Helpers ----------------------------------------------------------------

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((p) => (seen.has(p) ? false : seen.add(p)));
}

/**
 * Level-2 drill-down `detail` (AC-27) per architecture node — deterministic,
 * never left to the LLM. `service` nodes get no detail (an external service
 * has no internal file structure — an honest gap, not a fabrication).
 * `package` nodes get a sub-diagram of their own top-ranked files. `file`
 * nodes get a sub-diagram of the real getCriticalPaths chain they appear in,
 * if any. Either way, absent real facts, `detail` stays undefined and the
 * client shows an honest "no detail available" message rather than a blank
 * modal (never invalid/empty mermaid strings).
 */
function buildNodeDetails(
  nodes: DiagramNode[],
  packages: Array<{ name?: string; relativePath: string }>,
  rankedPaths: string[],
  criticalChains: string[][],
): DiagramNode[] {
  return nodes.map((node) => {
    if (node.isOverflow) return node;

    if (node.kind === "service") {
      return { ...node, detail: undefined };
    }

    if (node.kind === "package") {
      const pkg = packages.find(
        (p) => p.name === node.label || p.name === node.id,
      );
      if (!pkg) return { ...node, detail: undefined };
      const pkgDir = pkg.relativePath.replace(/\/package\.json$/, "");
      const belongsToPkg = (p: string) =>
        pkgDir === "" || p === pkgDir || p.startsWith(`${pkgDir}/`);
      const pkgFiles = rankedPaths.filter(belongsToPkg).slice(0, 5);
      return { ...node, detail: buildSubDiagram(pkgFiles, criticalChains) ?? undefined };
    }

    // kind === "file": show it in the context of the real BFS chain (if any)
    // it appears in — post-grounding, node.id is guaranteed to be a known
    // file path for file-kind nodes.
    const chain = criticalChains.find((c) => c.includes(node.id));
    if (!chain) return { ...node, detail: undefined };
    return { ...node, detail: buildSubDiagram(chain, criticalChains) ?? undefined };
  });
}

/**
 * Deterministic mermaid flowchart of `files`, edges taken only from real
 * getCriticalPaths chains restricted to pairs both present in `files` — never
 * a fabricated relationship. Returns `null` (no diagram) when there are fewer
 * than 2 files, or when none of them have a real connecting edge — a lone
 * box, or disconnected boxes, isn't an "architecture," it's just restating a
 * file name; the honest "no detail available" message beats a pointless box.
 */
function buildSubDiagram(files: string[], chains: string[][]): string | null {
  if (files.length < 2) return null;

  const idMap = new Map(files.map((f, i) => [f, `n${i}`]));
  const fileSet = new Set(files);
  const seenEdges = new Set<string>();
  const edgeLines: string[] = [];
  for (const chain of chains) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i]!;
      const b = chain[i + 1]!;
      if (!fileSet.has(a) || !fileSet.has(b)) continue;
      const key = `${a}->${b}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edgeLines.push(`  ${idMap.get(a)} --> ${idMap.get(b)}`);
    }
  }
  if (edgeLines.length === 0) return null;

  // Same file=blue color convention as the top-level diagram (client's
  // `kindFile` classDef) — every node here is always a real file path, so a
  // single consistent color class is enough, no per-node kind distinction.
  const lines = ["flowchart TD"];
  for (const f of files) lines.push(`  ${idMap.get(f)}["${f}"]:::detailFile`);
  lines.push(...edgeLines);
  lines.push("  classDef detailFile fill:#0f1b2d,stroke:#60a5fa,color:#e2e8f0");
  return lines.join("\n");
}

/**
 * Remove and return the first item in `bucket` whose `packageId` isn't
 * already represented in `selected`; falls back to plain FIFO (`shift()`)
 * once every remaining candidate's package is already represented (or the
 * repo is single-package, where this is a no-op equivalent to `shift()`).
 */
function pickPreferringNewPackage(
  bucket: FirstTask[],
  selected: FirstTask[],
): FirstTask | undefined {
  const seenPackages = new Set(selected.map((t) => t.packageId));
  const idx = bucket.findIndex((t) => !seenPackages.has(t.packageId));
  if (idx === -1) return bucket.shift();
  return bucket.splice(idx, 1)[0];
}

export function buildRunCommands(
  facts: Awaited<ReturnType<typeof collectFacts>>,
): string[] {
  const pm = facts.packageManager === "unknown" ? "npm" : facts.packageManager;
  const install = pm === "npm" ? "npm install" : `${pm} install`;
  const dev = pm === "npm" ? "npm run dev" : `${pm} dev`;
  const commands = [install, dev];

  // Include docker if services detected
  if (facts.dockerServices.length > 0) {
    commands.unshift("docker compose up -d");
  }

  return commands;
}

function buildUserPrompt(args: {
  repoName: string;
  rankedPaths: string[];
  readingPathFiles: string[];
  facts: Awaited<ReturnType<typeof collectFacts>>;
  criticalChains: string[][];
  filesIndexed: number;
  headSha: string;
  mechanicalHowToRun: HowToRunSection;
  firstTasks: FirstTask[];
}): string {
  const {
    repoName,
    rankedPaths,
    readingPathFiles,
    facts,
    criticalChains,
    filesIndexed,
    headSha,
    mechanicalHowToRun,
    firstTasks,
  } = args;

  return `<untrusted>
Repository: ${repoName}
HEAD SHA: ${headSha}
Files indexed: ${filesIndexed}

## Top-ranked files (by percentile × hotness)
${rankedPaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}

## Critical reading path
${readingPathFiles.map((p, i) => `${i + 1}. ${p}`).join("\n")}

## Packages detected
${facts.packages.map((p) => `- ${p.name ?? "unknown"} (${p.role}) — ${p.relativePath}`).join("\n")}

## Docker services
${facts.dockerServices.length > 0 ? facts.dockerServices.map((s) => `- ${s.name}: ${s.image ?? "custom"}`).join("\n") : "(none)"}

## Environment variables
${facts.envVars.length > 0 ? facts.envVars.join(", ") : "(none detected)"}

## How to run (pre-computed — use as-is in howToRun section)
Package manager: ${mechanicalHowToRun.packageManager}
Commands: ${mechanicalHowToRun.commands.join(" && ")}
Entrypoint: ${mechanicalHowToRun.entrypoint}

## First tasks (pre-computed — use as-is in firstTasks section)
${firstTasks.map((t) => `- [${t.gapType}] ${t.title}: ${t.suggestedPath}`).join("\n")}
</untrusted>

Produce a full Onboarding JSON object for this repository covering all 5 sections.
Use the pre-computed howToRun and firstTasks data above — do NOT invent new commands or tasks.
Base all file references ONLY on paths listed above.`;
}

/**
 * Deterministically mirrors repoIntel.getCriticalPaths' BFS traversal order
 * (AC-17/R18) — `readingPathFiles` is already `dedupePaths(criticalChains.flat())`,
 * so `order` here IS the traversal order, not an LLM's own judgment call.
 */
function buildReadingPath(
  readingPathFiles: string[],
  repoFullName: string,
  sha: string,
): ReadingPathItem[] {
  return readingPathFiles.slice(0, 8).map((file, i) => ({
    order: i + 1,
    file,
    reason:
      i === 0
        ? "Start here — top of the critical-path traversal"
        : `Next in the critical-path traversal (step ${i + 1})`,
    openUrl: `https://github.com/${repoFullName}/blob/${sha}/${file}`,
  }));
}

/**
 * Per-section fallback for a degraded/failed repo-intel index (AC-21/R22).
 * No LLM call at all — architecture is a bare top-level directory listing,
 * criticalPaths/readingPath fall back to package-manifest entrypoints (the
 * only real, verified paths available without a working rank index).
 */
async function buildDegradedSkeleton(args: {
  repoName: string;
  filesIndexed: number;
  headSha: string;
  clonePath: string;
  facts: Awaited<ReturnType<typeof collectFacts>>;
  mechanicalHowToRun: HowToRunSection;
}): Promise<Onboarding> {
  const { repoName, filesIndexed, headSha, clonePath, facts, mechanicalHowToRun } =
    args;

  let topLevelDirs: string[] = [];
  try {
    const entries = await readdir(clonePath, { withFileTypes: true });
    const skip = new Set([
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "coverage",
    ]);
    topLevelDirs = entries
      .filter(
        (e) => e.isDirectory() && !skip.has(e.name) && !e.name.startsWith("."),
      )
      .map((e) => e.name);
  } catch {
    topLevelDirs = [];
  }

  const architecture: ArchitectureSection = {
    overview:
      "Repository index is degraded — showing a top-level directory listing only (no architecture narrative or diagram available).",
    style: "unknown",
    nodes: topLevelDirs.map((dir, i) => ({
      id: `d${i}`,
      label: dir,
      kind: "package" as const,
    })),
    edges: [],
  };

  const buildOpenUrl = (file: string) =>
    `https://github.com/${repoName}/blob/${headSha}/${file}`;

  const criticalPaths: CriticalPathItem[] = facts.packages
    .slice(0, 8)
    .map((pkg) => ({
      file: pkg.relativePath,
      whyItMatters: "Package manifest (entrypoint heuristic — index degraded)",
      openUrl: buildOpenUrl(pkg.relativePath),
    }));

  const readingPath: ReadingPathItem[] = facts.packages
    .slice(0, 8)
    .map((pkg, i) => ({
      order: i + 1,
      file: pkg.relativePath,
      reason: "Entrypoint heuristic — index degraded, no rank data available",
      openUrl: buildOpenUrl(pkg.relativePath),
    }));

  return {
    repoName,
    filesIndexed,
    generatedAt: new Date().toISOString(),
    headSha,
    narrativeUnavailable: true,
    sections: {
      architecture,
      criticalPaths,
      howToRun: mechanicalHowToRun,
      readingPath,
      // Skipped — no rank data to detect gaps against; the honest message is
      // carried at the top level via `narrativeUnavailable`.
      firstTasks: [],
    },
  };
}

function buildSkeleton(args: {
  repoName: string;
  filesIndexed: number;
  headSha: string;
  mechanicalHowToRun: HowToRunSection;
  readingPathFiles: string[];
  rankedPaths: string[];
  firstTasks: FirstTask[];
}): Onboarding {
  const {
    repoName,
    filesIndexed,
    headSha,
    mechanicalHowToRun,
    readingPathFiles,
    rankedPaths,
    firstTasks,
  } = args;

  const criticalPaths: CriticalPathItem[] = rankedPaths
    .slice(0, 5)
    .map((f) => ({
      file: f,
      whyItMatters: "High-ranked file (narrative unavailable)",
      openUrl: `https://github.com/${repoName}/blob/HEAD/${f}`,
    }));

  const readingPath: ReadingPathItem[] = buildReadingPath(
    readingPathFiles,
    repoName,
    "HEAD",
  );

  const architecture: ArchitectureSection = {
    overview:
      "Narrative unavailable — LLM call failed. See file list for structure.",
    style: "unknown",
    nodes: rankedPaths.slice(0, 5).map((f, i) => ({
      id: `f${i}`,
      label: f.split("/").pop() ?? f,
      kind: "file" as const,
    })),
    edges: [],
  };

  return {
    repoName,
    filesIndexed,
    generatedAt: new Date().toISOString(),
    headSha,
    narrativeUnavailable: true,
    sections: {
      architecture,
      criticalPaths,
      howToRun: mechanicalHowToRun,
      readingPath,
      firstTasks,
    },
  };
}
