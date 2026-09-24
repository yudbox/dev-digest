/* SmartDiffViewer — displays PR files grouped by classifier role (core /
   tests / wiring / docs / boilerplate). Shows token badge, too-big banner,
   a per-group "files with findings" counter, and delegates per-file
   rendering (dot, chips, markers, cards) to the existing FileCard — the
   only data source is the smart-diff response's `line_findings`
   (SPEC-2026-09-23-smart-diff-hw3-upgrade, AC-31). */
"use client";

import React, { type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { SmartDiff, SmartDiffGroup, SmartDiffRole } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { FileCard } from "@/components/diff-viewer/FileCard";
import { chevronFor } from "@/components/diff-viewer/styles";
import type { PrFile } from "@/lib/types";
import type { DiffCommentApi, DiffFindingsApi } from "@/components/diff-viewer";
import { hasActive } from "@/components/diff-viewer/findings";

// ── Colour palette for roles (Q5: two additional design-system-style colours,
//    distinct from the three pre-existing role dots) ─────────────────────────

const ROLE_DOT: Record<SmartDiffRole, string> = {
  core: "#3b82f6", // blue
  tests: "#8b5cf6", // violet
  wiring: "#f59e0b", // amber
  docs: "#14b8a6", // teal
  boilerplate: "#6b7280", // gray
};

const ROLE_LABEL_KEY: Record<SmartDiffRole, "coreLabel" | "testsLabel" | "wiringLabel" | "docsLabel" | "boilerplateLabel"> = {
  core: "coreLabel",
  tests: "testsLabel",
  wiring: "wiringLabel",
  docs: "docsLabel",
  boilerplate: "boilerplateLabel",
};

const ROLE_DESC_KEY: Record<SmartDiffRole, "coreDesc" | "testsDesc" | "wiringDesc" | "docsDesc" | "boilerplateDesc"> = {
  core: "coreDesc",
  tests: "testsDesc",
  wiring: "wiringDesc",
  docs: "docsDesc",
  boilerplate: "boilerplateDesc",
};

/** Groups collapsed by default (AC-15) — exceptions: the deep-link target
 *  file, and any file whose `line_findings` is non-empty (accepted included). */
const COLLAPSED_BY_DEFAULT: Partial<Record<SmartDiffRole, true>> = {
  docs: true,
  boilerplate: true,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function GroupSection({
  group,
  files,
  commenting,
  findings,
  t,
  targetFile,
  targetLine,
}: {
  group: SmartDiffGroup;
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingsApi;
  t: ReturnType<typeof useTranslations<"prReview.smartDiff">>;
  targetFile?: string;
  targetLine?: number;
}) {
  const dot = ROLE_DOT[group.role];
  const label = t(ROLE_LABEL_KEY[group.role]);
  const desc = t(ROLE_DESC_KEY[group.role]);
  const collapsedByDefault = !!COLLAPSED_BY_DEFAULT[group.role];

  const fileMap = new Map(files.map((f) => [f.path, f]));

  // AC-14: count of files in this group with at least one ACTIVE (not
  // accepted) finding — real data from `line_findings`, no per-line reduction.
  const filesWithFindings = group.files.filter((f) =>
    hasActive(f.line_findings),
  ).length;

  // The group itself is an accordion. A non-empty group starts expanded; an
  // empty one (always returned by the server, "0 files") has nothing to show
  // and can't be expanded. A deep link into this group forces it open.
  const isEmpty = group.files.length === 0;
  const containsTarget =
    !!targetFile && group.files.some((f) => f.path === targetFile);
  const [open, setOpen] = React.useState(!isEmpty);
  React.useEffect(() => {
    if (containsTarget) setOpen(true);
  }, [containsTarget]);
  const expanded = open && !isEmpty;

  return (
    <div style={s.group} data-testid={`group-${group.role}`}>
      <div
        role="button"
        aria-expanded={expanded}
        aria-disabled={isEmpty}
        tabIndex={isEmpty ? -1 : 0}
        onClick={() => !isEmpty && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (isEmpty) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{ ...s.groupHeader, cursor: isEmpty ? "default" : "pointer" }}
      >
        <Icon.ChevronRight
          size={13}
          style={{ ...chevronFor(expanded), opacity: isEmpty ? 0.35 : 1 }}
        />
        <span style={{ ...s.dot, background: dot }} />
        <span style={s.groupLabel}>{label}</span>
        <span style={s.groupDesc}>{desc}</span>
        <span style={s.groupRight}>
          {filesWithFindings > 0 && (
            <span style={s.findingsCount}>
              {t("filesWithFindings", { count: filesWithFindings })}
            </span>
          )}
          <span style={s.groupCount}>
            {t("filesCount", { count: group.files.length })}
          </span>
        </span>
      </div>

      {expanded && group.files.map((smartFile) => {
        const prFile = fileMap.get(smartFile.path);
        if (!prFile) return null;

        // A collapsed-by-default group still expands a file with real
        // findings (including accepted-only) — the collapse default is about
        // reducing noise, not hiding real findings (AC-15).
        const hasFindings = (smartFile.line_findings?.length ?? 0) > 0;
        const initialOpen =
          targetFile === prFile.path || !collapsedByDefault || hasFindings;

        return (
          <div key={smartFile.path} style={s.fileWrapper}>
            {smartFile.pseudocode_summary && (
              <div style={s.whatDoes}>
                <span style={s.whatDoesLabel}>{t("whatDoes")}</span>{" "}
                {smartFile.pseudocode_summary}
              </div>
            )}
            <FileCard
              file={prFile}
              commenting={commenting}
              findings={findings}
              initialOpen={initialOpen}
              targetLine={targetFile === prFile.path ? targetLine : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingsApi;
  targetFile?: string;
  targetLine?: number;
}

export function SmartDiffViewer({
  smartDiff,
  files,
  commenting,
  findings,
  targetFile,
  targetLine,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview.smartDiff");
  const { split_suggestion, review_tokens, groups } = smartDiff;

  // Scroll to target file if coming from a file ref link
  React.useEffect(() => {
    if (!targetFile) return;
    const el = document.getElementById(`diff-file-${targetFile}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [targetFile]);

  // Empty state instead of zero counters: `line_findings` is `null` on every
  // file until the first review runs (a finished review with no findings
  // gives `[]`, which is NOT this state).
  const reviewNotRun =
    groups.some((g) => g.files.length > 0) &&
    groups.every((g) => g.files.every((f) => f.line_findings == null));

  const totalFiles = files.length;
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div style={s.root}>
      {/* Section header */}
      <div style={s.sectionHeader}>
        <div style={s.sectionStats}>
          <span style={s.statFiles}>{t("filesCount", { count: totalFiles })}</span>
          <span style={s.statSep}>·</span>
          <span style={s.statAdd}>+{totalAdditions}</span>
          <span style={s.statDel}>-{totalDeletions}</span>
        </div>
      </div>

      {/* Token badge */}
      <div style={s.tokenBadge}>
        <span>⚡</span>
        {review_tokens != null ? (
          <>
            <span style={s.tokenMuted}>{t("zeroTokens")} · </span>
            <span style={s.tokenMuted}>
              {t("builtOn", { count: review_tokens })}
            </span>
          </>
        ) : (
          <span style={s.tokenMuted}>{t("zeroTokens")}</span>
        )}
      </div>

      {reviewNotRun && (
        <div role="status" style={s.reviewNotRun}>
          <span aria-hidden>ⓘ</span> {t("reviewNotRun")}
        </div>
      )}

      {/* Too-big banner */}
      {split_suggestion.too_big && (
        <div style={s.tooBigBanner}>
          ⚠ {t("largeTitle", { lines: split_suggestion.total_lines })}
        </div>
      )}

      {/* All five groups, always, in display order core → tests → wiring →
          docs → boilerplate (AC-8) — empty ones show their label + "0 files". */}
      {groups.map((group) => (
        <GroupSection
          key={group.role}
          group={group}
          files={files}
          commenting={commenting}
          findings={findings}
          t={t}
          targetFile={targetFile}
          targetLine={targetLine}
        />
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  root: { display: "flex", flexDirection: "column", gap: 24 },
  sectionHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBottom: 8,
    borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  },
  sectionIcon: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "var(--text-muted)",
  },
  sectionStats: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
  },
  statFiles: { color: "var(--text-secondary)" },
  statSep: { color: "var(--text-muted)" },
  statAdd: { color: "#4ade80" },
  statDel: { color: "#f87171" },
  group: { display: "flex", flexDirection: "column", gap: 8 },
  // Sticks to the top while scrolling through the group, pinned right under
  // the (itself sticky) PR header via `--pr-header-h`; opaque so code doesn't
  // show through, and above file cards but below the PR header (zIndex 5).
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
    position: "sticky",
    top: "var(--pr-header-h, 0px)",
    zIndex: 4,
    background: "var(--bg-primary)",
  },
  dot: { width: 10, height: 10, borderRadius: 2, flexShrink: 0 },
  groupLabel: { fontWeight: 600, fontSize: 13, color: "var(--text-primary)" },
  groupDesc: { fontSize: 12, color: "var(--text-muted)" },
  findingsCount: { fontSize: 12, fontWeight: 600, color: "var(--crit)" },
  groupRight: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
  },
  groupCount: { fontSize: 12, color: "var(--text-muted)" },
  fileWrapper: { display: "flex", flexDirection: "column", gap: 4 },
  whatDoes: { fontSize: 12, color: "var(--text-secondary)", paddingLeft: 4 },
  whatDoesLabel: { fontWeight: 600, color: "var(--text-muted)" },
  badges: { display: "flex", gap: 8, paddingLeft: 4 },
  badge: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    padding: "2px 0",
  },
  tokenBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "#4ade80",
    padding: "4px 0",
  },
  tokenMuted: { fontWeight: 400, color: "var(--text-muted)" },
  reviewNotRun: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "10px 12px",
    border: "1px dashed var(--border)",
    borderRadius: 7,
  },
  tooBigBanner: {
    fontSize: 12,
    color: "#f97316",
    background: "rgba(249, 115, 22, 0.08)",
    border: "1px solid rgba(249, 115, 22, 0.25)",
    borderRadius: 6,
    padding: "6px 12px",
  },
};
