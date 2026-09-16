/**
 * CiRepository — the ONLY layer touching the DB for the CI module.
 * Owns `ci_installations`, `ci_runs`, and `ci_run_findings`.
 * Onion Architecture: Infrastructure layer. No business logic here.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import type {
  CiInstallation,
  CiInstallationRow,
  CiInstallationsResponse,
  CiRun,
  CiRunsQuery,
} from "@devdigest/shared";
import type { Finding } from "@devdigest/shared";

export type CiInstallationDbRow = typeof t.ciInstallations.$inferSelect;
export type CiRunDbRow = typeof t.ciRuns.$inferSelect;

export interface UpsertInstallationInput {
  agentId: string;
  repo: string;
  targetType: "gha" | "circle" | "jenkins" | "cli";
}

export interface UpsertRunInput {
  ciInstallationId: string;
  prNumber: number | null;
  prTitle: string | null;
  ranAt: Date | null;
  status: string;
  findingsCount: number;
  critical: number;
  warning: number;
  suggestion: number;
  durationMs: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  source: string | null;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- installations -------------------------------------------------------

  async upsertInstallation(
    input: UpsertInstallationInput,
  ): Promise<CiInstallationDbRow> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: { targetType: input.targetType },
      })
      .returning();
    return row!;
  }

  async listInstallationsForAgent(
    agentId: string,
  ): Promise<CiInstallationsResponse> {
    // Subquery: latest run per installation
    const latestRun = this.db
      .select({
        ciInstallationId: t.ciRuns.ciInstallationId,
        status: sql<string | null>`last_value(${t.ciRuns.status}) OVER (
          PARTITION BY ${t.ciRuns.ciInstallationId}
          ORDER BY ${t.ciRuns.ranAt} ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        )`.as("last_status"),
        ranAt: sql<Date | null>`last_value(${t.ciRuns.ranAt}) OVER (
          PARTITION BY ${t.ciRuns.ciInstallationId}
          ORDER BY ${t.ciRuns.ranAt} ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        )`.as("last_ran_at"),
      })
      .from(t.ciRuns)
      .as("lr");

    // Simpler approach: two separate queries
    const installations = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciInstallations.installedAt));

    if (installations.length === 0) {
      return { installations: [], active_count: 0 };
    }

    const installationIds = installations.map((i) => i.id);

    // Get latest run per installation
    const latestRuns = await this.db
      .select({
        ciInstallationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
      })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, installationIds))
      .orderBy(desc(t.ciRuns.ranAt));

    // Build a map of installation_id → latest run
    const latestRunMap = new Map<
      string,
      { status: string | null; ranAt: Date | null }
    >();
    for (const run of latestRuns) {
      if (run.ciInstallationId && !latestRunMap.has(run.ciInstallationId)) {
        latestRunMap.set(run.ciInstallationId, {
          status: run.status,
          ranAt: run.ranAt,
        });
      }
    }

    const rows: CiInstallationRow[] = installations.map((inst) => {
      const latest = latestRunMap.get(inst.id);
      return {
        id: inst.id,
        agent_id: inst.agentId,
        repo: inst.repo,
        target_type: inst.targetType as CiInstallation["target_type"],
        installed_at: inst.installedAt.toISOString(),
        last_run_status: latest?.status ?? null,
        last_ran_at: latest?.ranAt?.toISOString() ?? null,
      };
    });

    return {
      installations: rows,
      active_count: installations.length,
    };
  }

  async listInstallationsAll(): Promise<CiInstallationDbRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .orderBy(t.ciInstallations.installedAt);
  }

  async getInstallation(id: string): Promise<CiInstallationDbRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, id));
    return row;
  }

  async updateSyncState(
    installationId: string,
    update: { etag: string | null; at: Date },
  ): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({ lastSyncedEtag: update.etag, lastSyncedAt: update.at })
      .where(eq(t.ciInstallations.id, installationId));
  }

  // ---- ci_runs -------------------------------------------------------------

  /**
   * Upsert a CI run. Idempotency key: githubUrl (which encodes the GH run id).
   * On conflict (same githubUrl) update mutable fields only.
   */
  async upsertRun(input: UpsertRunInput): Promise<CiRunDbRow> {
    const [row] = await this.db
      .insert(t.ciRuns)
      .values({
        ciInstallationId: input.ciInstallationId,
        prNumber: input.prNumber,
        prTitle: input.prTitle,
        ranAt: input.ranAt,
        status: input.status,
        findingsCount: input.findingsCount,
        critical: input.critical,
        warning: input.warning,
        suggestion: input.suggestion,
        durationMs: input.durationMs,
        costUsd: input.costUsd,
        githubUrl: input.githubUrl,
        source: input.source,
      })
      .onConflictDoUpdate({
        target: t.ciRuns.githubUrl,
        set: {
          status: input.status,
          prTitle: input.prTitle,
          findingsCount: input.findingsCount,
          critical: input.critical,
          warning: input.warning,
          suggestion: input.suggestion,
          durationMs: input.durationMs,
          costUsd: input.costUsd,
          ranAt: input.ranAt,
        },
      })
      .returning();
    return row!;
  }

  // ---- ci_run_findings ------------------------------------------------------

  async insertRunFindings(ciRunId: string, findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;

    // Delete existing findings for this run (idempotent re-ingest)
    await this.db
      .delete(t.ciRunFindings)
      .where(eq(t.ciRunFindings.ciRunId, ciRunId));

    await this.db.insert(t.ciRunFindings).values(
      findings.map((f) => ({
        id: randomUUID(),
        ciRunId,
        file: f.file,
        startLine: f.start_line,
        endLine: f.end_line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        kind: f.kind ?? "finding",
      })),
    );
  }

  // ---- list ci_runs (with server-side filters) ------------------------------

  async listRuns(filters: CiRunsQuery): Promise<CiRun[]> {
    const conditions = [];

    if (filters.from) {
      conditions.push(gte(t.ciRuns.ranAt, new Date(filters.from)));
    }
    if (filters.to) {
      conditions.push(lte(t.ciRuns.ranAt, new Date(filters.to)));
    }
    if (filters.status) {
      conditions.push(eq(t.ciRuns.status, filters.status));
    }
    if (filters.repo) {
      conditions.push(eq(t.ciInstallations.repo, filters.repo));
    }
    if (filters.source) {
      conditions.push(eq(t.ciInstallations.targetType, filters.source as 'gha' | 'circle' | 'jenkins' | 'cli'));
    }

    const rows = await this.db
      .select({
        run: t.ciRuns,
        repo: t.ciInstallations.repo,
        targetType: t.ciInstallations.targetType,
        agentName: t.agents.name,
      })
      .from(t.ciRuns)
      .leftJoin(
        t.ciInstallations,
        eq(t.ciInstallations.id, t.ciRuns.ciInstallationId),
      )
      .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(t.ciRuns.ranAt));

    // Filter by agent name if requested
    const filteredRows = filters.agent
      ? rows.filter((r) => r.agentName === filters.agent)
      : rows;

    if (filteredRows.length === 0) return [];

    // Fetch findings for all runs
    const runIds = filteredRows.map((r) => r.run.id);
    const findingsRows = await this.db
      .select()
      .from(t.ciRunFindings)
      .where(inArray(t.ciRunFindings.ciRunId, runIds));

    // Group findings by run id
    const findingsMap = new Map<string, Finding[]>();
    for (const f of findingsRows) {
      const list = findingsMap.get(f.ciRunId) ?? [];
      list.push({
        id: f.id,
        file: f.file,
        start_line: f.startLine,
        end_line: f.endLine,
        severity: f.severity as Finding["severity"],
        category: f.category as Finding["category"],
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? undefined,
        confidence: f.confidence,
        kind: f.kind as Finding["kind"],

      });
      findingsMap.set(f.ciRunId, list);
    }

    return filteredRows.map(({ run, repo, targetType, agentName }) => ({
      id: run.id,
      ci_installation_id: run.ciInstallationId ?? null,
      pr_number: run.prNumber ?? null,
      pr_title: run.prTitle ?? null,
      ran_at: run.ranAt?.toISOString() ?? null,
      status: run.status ?? null,
      findings_count: run.findingsCount ?? null,
      critical: run.critical ?? null,
      warning: run.warning ?? null,
      suggestion: run.suggestion ?? null,
      cost_usd: run.costUsd ?? null,
      duration_ms: run.durationMs ?? null,
      github_url: run.githubUrl ?? null,
      source: run.source ?? null,
      repo: repo ?? undefined,
      target_type: (targetType ?? undefined) as CiRun["target_type"],
      agent: agentName ?? undefined,
      duration_s: run.durationMs ? run.durationMs / 1000 : undefined,
      findings: findingsMap.get(run.id) ?? [],
    }));
  }

  // ---- installations with workspace (for ingest) ---------------------------

  /**
   * Returns all installations joined with the owning agent's workspaceId.
   * Used by ingestAll so agent_runs rows can be attributed to the correct workspace.
   */
  async listInstallationsAllWithWorkspace(): Promise<
    Array<CiInstallationDbRow & { workspaceId: string }>
  > {
    const rows = await this.db
      .select({
        inst: t.ciInstallations,
        workspaceId: t.agents.workspaceId,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .orderBy(t.ciInstallations.installedAt);

    return rows.map(({ inst, workspaceId }) => ({ ...inst, workspaceId }));
  }

  // ---- agent_runs (cross-module insert for CI source rows) -----------------

  /**
   * Insert a single agent_runs row attributed to a CI run (source='ci').
   * DB access here (not in the service) to keep the Onion Architecture clean.
   */
  async insertAgentRun(input: {
    workspaceId: string;
    agentId: string | null;
    status: string;
    findingsCount: number;
    durationMs: number | null;
    costUsd: number | null;
  }): Promise<void> {
    await this.db.insert(t.agentRuns).values({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      source: "ci",
      status: input.status,
      findingsCount: input.findingsCount,
      durationMs: input.durationMs,
      costUsd: input.costUsd,
    });
  }
}
