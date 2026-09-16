import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";

export const ciInstallations = pgTable(
  "ci_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    targetType: text("target_type", {
      enum: ["gha", "circle", "jenkins", "cli"],
    }).notNull(),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Per-installation ingest state for conditional (If-None-Match) requests.
    lastSyncedEtag: text("last_synced_etag"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ci_installations_agent_id_repo_key").on(t.agentId, t.repo),
  ],
);

export const ciRuns = pgTable(
  "ci_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ciInstallationId: uuid("ci_installation_id").references(
      () => ciInstallations.id,
      {
        onDelete: "set null",
      },
    ),
    prNumber: integer("pr_number"),
    prTitle: text("pr_title"),
    ranAt: timestamp("ran_at", { withTimezone: true }),
    status: text("status"),
    findingsCount: integer("findings_count"),
    critical: integer("critical"),
    warning: integer("warning"),
    suggestion: integer("suggestion"),
    durationMs: integer("duration_ms"),
    costUsd: doublePrecision("cost_usd"),
    githubUrl: text("github_url"),
    source: text("source"),
  },
  (t) => [uniqueIndex("ci_runs_github_url_key").on(t.githubUrl)],
);

/**
 * Individual findings ingested from a CI run's `devdigest-result.json` artifact.
 * CI-owned (FK to `ci_runs`) so the CI Runs FINDINGS column can render
 * `SeverityChip`/`FindingsPopover` without touching the reviews-core `findings`
 * table (which FKs `review_id`, unavailable for CI runs). Mirrors the `Finding`
 * contract shape.
 */
export const ciRunFindings = pgTable("ci_run_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  ciRunId: uuid("ci_run_id")
    .notNull()
    .references(() => ciRuns.id, { onDelete: "cascade" }),
  file: text("file").notNull(),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  suggestion: text("suggestion"),
  confidence: doublePrecision("confidence").notNull(),
  kind: text("kind").notNull().default("finding"),
});
