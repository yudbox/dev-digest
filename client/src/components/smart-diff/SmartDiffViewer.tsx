/* SmartDiffViewer — displays PR files grouped by classifier role (core /
   wiring / boilerplate). Shows token badge, too-big banner, finding badges,
   and delegates per-file rendering to the existing FileCard. */
"use client";

import React, { type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { SmartDiff, SmartDiffGroup } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { PrFile } from "@/lib/types";
import type { DiffCommentApi } from "@/components/diff-viewer";

// ── Colour palette for roles ──────────────────────────────────────────────────

const ROLE_DOT: Record<string, string> = {
  core: "#3b82f6", // blue
  wiring: "#f59e0b", // amber
  boilerplate: "#6b7280", // gray
};

// ── Sub-components ────────────────────────────────────────────────────────────

function GroupSection({
  group,
  files,
  commenting,
  t,
}: {
  group: SmartDiffGroup;
  files: PrFile[];
  commenting?: DiffCommentApi;
  t: ReturnType<typeof useTranslations<"prReview.smartDiff">>;
}) {
  const dot = ROLE_DOT[group.role] ?? "#6b7280";
  const label = t(
    `${group.role}Label` as "coreLabel" | "wiringLabel" | "boilerplateLabel",
  );
  const desc = t(
    `${group.role}Desc` as "coreDesc" | "wiringDesc" | "boilerplateDesc",
  );
  const isBoilerplate = group.role === "boilerplate";

  const fileMap = new Map(files.map((f) => [f.path, f]));

  return (
    <div style={s.group}>
      <div style={s.groupHeader}>
        <span style={{ ...s.dot, background: dot }} />
        <span style={s.groupLabel}>{label}</span>
        <span style={s.groupDesc}>{desc}</span>
        <span style={s.groupCount}>{group.files.length} files</span>
      </div>

      {group.files.map((smartFile) => {
        const prFile = fileMap.get(smartFile.path);
        if (!prFile) return null;

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
              initialOpen={!isBoilerplate}
              lineBadges={
                smartFile.line_findings
                  ? new Map(
                      smartFile.line_findings.map((f) => [f.line, f.severity]),
                    )
                  : undefined
              }
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
}

export function SmartDiffViewer({
  smartDiff,
  files,
  commenting,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview.smartDiff");
  const { split_suggestion, review_tokens, groups } = smartDiff;

  const totalFiles = files.length;
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div style={s.root}>
      {/* Section header */}
      <div style={s.sectionHeader}>
        <div style={s.sectionStats}>
          <span style={s.statFiles}>{totalFiles} files</span>
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

      {/* Too-big banner */}
      {split_suggestion.too_big && (
        <div style={s.tooBigBanner}>
          ⚠ {t("largeTitle", { lines: split_suggestion.total_lines })}
        </div>
      )}

      {/* Groups */}
      {groups.map((group) => (
        <GroupSection
          key={group.role}
          group={group}
          files={files}
          commenting={commenting}
          t={t}
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
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 0",
  },
  dot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  groupLabel: { fontWeight: 600, fontSize: 13, color: "var(--text-primary)" },
  groupDesc: { fontSize: 12, color: "var(--text-muted)" },
  groupCount: { fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" },
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
  tooBigBanner: {
    fontSize: 12,
    color: "#f97316",
    background: "rgba(249, 115, 22, 0.08)",
    border: "1px solid rgba(249, 115, 22, 0.25)",
    borderRadius: 6,
    padding: "6px 12px",
  },
};
