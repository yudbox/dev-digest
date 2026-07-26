import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { now } from "./_shared";
import { workspaces } from "./core";
import { repos } from "./repos";

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  "memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id").references(() => repos.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["repo", "global", "team"] }).notNull(),
    kind: text("kind", {
      enum: ["decision", "convention", "preference", "fact", "learning"],
    }).notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    confidence: doublePrecision("confidence"),
    /** 'explicit' = user-added; 'auto' = distilled from dismissed findings. */
    source: text("source", { enum: ["explicit", "auto"] })
      .notNull()
      .default("explicit"),
    sources: jsonb("sources"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => ({ wsIdx: index("memory_ws_idx").on(t.workspaceId) }),
);

/**
 * Memory learning watermark — one row per workspace.
 * Tracks `last_processed_at` so the learning loop processes only NEW dismissals.
 * TASK-002 / GAP-1.
 */
export const memoryLearningState = pgTable("memory_learning_state", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  lastProcessedAt: timestamp("last_processed_at", {
    withTimezone: true,
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const conventions = pgTable("conventions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  repoId: uuid("repo_id").references(() => repos.id, { onDelete: "cascade" }),
  rule: text("rule").notNull(),
  evidencePath: text("evidence_path"),
  evidenceSnippet: text("evidence_snippet"),
  confidence: doublePrecision("confidence"),
  accepted: boolean("accepted").notNull().default(false),
  createdAt: now(),
});
