/**
 * CiService — Application layer for Export-to-CI + CI Runs ingest.
 *
 * Orchestrates:
 *   - CiRepository (own DB tables)
 *   - container.agentsRepo / container.skillsRepo (read-only cross-module)
 *   - assembleFiles (pure generators — no I/O except runner bundle read)
 *   - container.github() (GitHub API adapter)
 *
 * Onion Architecture: Application layer. No Drizzle queries here — all DB
 * access goes through CiRepository or the shared repos on container.
 */
import type { Container } from "../../platform/container.js";
import type {
  CiExportInput,
  CiFile,
  CiInstallation,
  CiInstallationRow,
  CiRun,
  CiRunsQuery,
  CiRefreshResult,
} from "@devdigest/shared";
import { CiResultArtifact } from "@devdigest/shared";
import { NotFoundError } from "../../platform/errors.js";
import { assembleFiles } from "./generators/index.js";
import type { CiRepository } from "./repository.js";
import { extractFirstFileFromZip } from "./zip.js";

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Derive CI run status from artifact presence + finding count.
 *
 * CRITICAL design invariant:
 *   gate-blocked run (red GH Actions job BUT artifact EXISTS because the
 *   DevDigest runner finished and uploaded results) → "succeeded", NOT "failed".
 *   The artifact's presence proves the runner completed; the gate failure is a
 *   deliberate policy decision, not a technical failure.
 */
export function deriveRunStatus(
  hasArtifact: boolean,
  findingsCount: number,
): "succeeded" | "failed" | "no_findings" {
  if (!hasArtifact) return "failed";
  if (findingsCount > 0) return "succeeded";
  return "no_findings";
}

// ---------------------------------------------------------------------------
// Service result type
// ---------------------------------------------------------------------------

/** Looser than the shared CiExport contract — allows null installation for action=files. */
export interface CiExportResult {
  installation: CiInstallation | null;
  files: CiFile[];
  pr_url: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = container.ciRepo;
  }

  // ---- Export ---------------------------------------------------------------

  /**
   * Export CI configuration for an agent.
   *
   * action=open_pr: commit files to "devdigest/ci" branch + open PR →
   *   upsert ci_installation + return installation + pr_url.
   * action=files: assemble files only, no GitHub calls, no installation row.
   */
  async exportCi(
    agentId: string,
    input: CiExportInput,
    workspaceId: string,
  ): Promise<CiExportResult> {
    // Load agent (scoped to workspace)
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError("Agent not found");

    // Load linked skills (cross-module read via container.agentsRepo)
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);
    const skills = linkedSkills.map((ls) => ({
      id: ls.skill.id,
      name: ls.skill.name,
      body: ls.skill.body,
    }));

    // Assemble CI files (may throw if runner dist is absent)
    const files = assembleFiles({
      agent: {
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
      },
      skills,
      workflow: {
        triggers: input.triggers,
        postAs: input.post_as,
      },
    });

    if (input.action === "files") {
      // No GitHub calls, no installation row for the zip path.
      return { installation: null, files, pr_url: null };
    }

    if (input.action === "preview") {
      // Preview: return files as JSON only — no GitHub calls, no installation.
      return { installation: null, files, pr_url: null };
    }

    // open_pr path: commit files → open PR → upsert installation
    const [owner, name] = input.repo.split("/") as [string, string];
    const repoRef = { owner, name };
    const gh = await this.container.github();

    await gh.commitFiles(repoRef, {
      branch: "devdigest/ci",
      base: input.base,
      message: "chore: add DevDigest CI review workflow",
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
    });

    // Reuse an existing open PR on the same branch rather than opening a second.
    let prUrl: string | null = null;
    const existingPr = await gh.findOpenPr(repoRef, "devdigest/ci");
    if (existingPr) {
      prUrl = existingPr.url;
    } else {
      const newPr = await gh.openPullRequest(repoRef, {
        title: "Add DevDigest CI Review",
        head: "devdigest/ci",
        base: input.base,
        body: "This PR adds the DevDigest CI review workflow and agent configuration files.",
      });
      prUrl = newPr.url;
    }

    const installRow = await this.repo.upsertInstallation({
      agentId,
      repo: input.repo,
      targetType: input.target,
    });

    const installation: CiInstallation = {
      id: installRow.id,
      agent_id: installRow.agentId,
      repo: installRow.repo,
      target_type: installRow.targetType as CiInstallation["target_type"],
      installed_at: installRow.installedAt.toISOString(),
    };

    return { installation, files, pr_url: prUrl };
  }

  // ---- Installations --------------------------------------------------------

  async getInstallations(
    agentId: string,
  ): Promise<{ installations: CiInstallationRow[]; activeCount: number }> {
    const resp = await this.repo.listInstallationsForAgent(agentId);
    return {
      installations: resp.installations,
      activeCount: resp.active_count,
    };
  }

  /**
   * Re-export CI config to every existing installation for an agent.
   * Used when the agent's prompt, skills, or settings change.
   */
  async updateCiConfig(agentId: string, workspaceId: string): Promise<void> {
    const resp = await this.repo.listInstallationsForAgent(agentId);
    for (const inst of resp.installations) {
      await this.exportCi(
        agentId,
        {
          repo: inst.repo,
          target: inst.target_type,
          action: "open_pr",
          post_as: "github_review",
          triggers: ["opened", "synchronize", "reopened"],
          base: "main",
        },
        workspaceId,
      );
    }
  }

  // ---- Ingest ---------------------------------------------------------------

  /**
   * Pull CI workflow run results from GitHub for ALL installations and persist
   * them as ci_runs + agent_runs rows.
   *
   * Uses If-None-Match conditional requests (ETag) so unchanged run lists are
   * skipped with a lightweight 304 response.
   */
  async ingestAll(_workspaceId: string): Promise<CiRefreshResult> {
    const installations = await this.repo.listInstallationsAllWithWorkspace();
    let ingested = 0;

    for (const installation of installations) {
      const [owner, name] = installation.repo.split("/") as [string, string];
      const repoRef = { owner, name };
      const gh = await this.container.github();

      const result = await gh.listWorkflowRuns(repoRef, {
        etag: installation.lastSyncedEtag ?? undefined,
      });

      if (result.notModified) {
        // 304: update the sync timestamp but keep the existing ETag
        await this.repo.updateSyncState(installation.id, {
          etag: result.etag,
          at: new Date(),
        });
        continue;
      }

      // Process completed runs only (skip in_progress / queued)
      for (const run of result.runs) {
        if (run.status !== "completed") continue;

        // Find the devdigest-result artifact
        const artifact = run.artifacts.find(
          (a) => a.name === "devdigest-result",
        );

        // Fetch PR title (best-effort — PR may have been deleted)
        let prTitle: string | null = null;
        if (run.prNumber != null) {
          try {
            const pr = await gh.getPullRequest(repoRef, run.prNumber);
            prTitle = pr.title;
          } catch {
            // ignore
          }
        }

        let status: "succeeded" | "failed" | "no_findings";
        let findingsCount = 0;
        let critical = 0;
        let warning = 0;
        let suggestion = 0;
        let costUsd: number | null = null;
        let durationMs: number | null = null;
        let artifactFindings: import("@devdigest/shared").CiResultArtifact["findings"] =
          [];

        if (!artifact) {
          status = "failed";
        } else {
          // Download ZIP, extract JSON, parse artifact
          const zipBuf = await gh.downloadArtifact(repoRef, artifact.id);
          let jsonBuf: Buffer;
          try {
            jsonBuf = extractFirstFileFromZip(zipBuf);
          } catch {
            // Fallback: buffer is already raw JSON (e.g. mock in tests that
            // deliberately returns unwrapped content for simplicity)
            jsonBuf = zipBuf;
          }

          const parsed = CiResultArtifact.safeParse(
            JSON.parse(jsonBuf.toString("utf-8")),
          );

          if (!parsed.success) {
            // Malformed artifact → treat as failed, skip findings
            status = "failed";
          } else {
            findingsCount = parsed.data.findings_count;
            critical = parsed.data.critical ?? 0;
            warning = parsed.data.warning ?? 0;
            suggestion = parsed.data.suggestion ?? 0;
            costUsd = parsed.data.cost_usd ?? null;
            durationMs = parsed.data.duration_ms ?? null;
            artifactFindings = parsed.data.findings;
            status = deriveRunStatus(true, findingsCount);
          }
        }

        const ciRunRow = await this.repo.upsertRun({
          ciInstallationId: installation.id,
          prNumber: run.prNumber,
          prTitle,
          ranAt: new Date(),
          status,
          findingsCount,
          critical,
          warning,
          suggestion,
          durationMs,
          costUsd,
          githubUrl: run.htmlUrl,
          source: installation.targetType,
        });

        // Insert agent_runs row (cross-module, via CiRepository)
        await this.repo.insertAgentRun({
          workspaceId: installation.workspaceId,
          agentId: installation.agentId,
          status,
          findingsCount,
          durationMs,
          costUsd,
        });

        // Insert ci_run_findings
        if (artifactFindings.length > 0) {
          await this.repo.insertRunFindings(ciRunRow.id, artifactFindings);
        }

        ingested++;
      }

      // Update ETag for next conditional request
      await this.repo.updateSyncState(installation.id, {
        etag: result.etag,
        at: new Date(),
      });
    }

    return {
      synced_at: new Date().toISOString(),
      ingested,
      installations_checked: installations.length,
    };
  }

  // ---- CI Runs --------------------------------------------------------------

  async getCiRuns(filters: CiRunsQuery): Promise<CiRun[]> {
    return this.repo.listRuns(filters);
  }
}
