/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { SeverityChip } from "@/components/SeverityChip/SeverityChip";

const JUMPABLE_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(
  ln: Line,
  matched: Map<string, CommentThread[]>,
): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  initialOpen,
  lineBadges,
  targetLine,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  initialOpen?: boolean;
  lineBadges?: Map<number, { severity: string; findingId: string }>;
  targetLine?: number;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    initialOpen ??
      (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES,
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // One count + jump-target line per severity present in this file — reuses
  // the same SeverityChip already used for run-level counts (Test Quality
  // Rev... "△ 3 · ◇ 2"), just scoped to this file's findings instead of a run.
  const severityGroups = React.useMemo(() => {
    if (!lineBadges || lineBadges.size === 0) return null;
    const groups = {} as Record<
      (typeof JUMPABLE_SEVERITIES)[number],
      { count: number; line: number }
    >;
    for (const [line, b] of lineBadges) {
      if (!JUMPABLE_SEVERITIES.includes(b.severity as never)) continue;
      const sev = b.severity as (typeof JUMPABLE_SEVERITIES)[number];
      const existing = groups[sev];
      if (existing) {
        existing.count += 1;
        existing.line = Math.min(existing.line, line);
      } else {
        groups[sev] = { count: 1, line };
      }
    }
    return Object.keys(groups).length > 0 ? groups : null;
  }, [lineBadges]);

  // Locally-controlled scroll target: starts from the URL-driven `targetLine`
  // prop, but can be overridden by clicking one of the severity chips below.
  const [localTargetLine, setLocalTargetLine] = React.useState(targetLine);
  React.useEffect(() => setLocalTargetLine(targetLine), [targetLine]);

  React.useEffect(() => {
    if (!open || localTargetLine === undefined) return;
    const id = `diff-line-${file.path}-${localTargetLine}`;
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, localTargetLine, file.path]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments)
      return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(
      comments.filter((c) => c.path === file.path),
    );
    const renderedKeys = new Set<string>();
    for (const ln of lines)
      for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div id={`diff-file-${file.path}`} style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {severityGroups && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {JUMPABLE_SEVERITIES.map((sev) => {
              const group = severityGroups[sev];
              if (!group) return null;
              return (
                <SeverityChip
                  key={sev}
                  sev={sev}
                  count={group.count}
                  onClick={() => {
                    setOpen(true);
                    setLocalTargetLine(group.line);
                  }}
                />
              );
            })}
          </div>
        )}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                badge={lineBadges?.get(ln.newNo ?? ln.oldNo ?? -1)}
                targetLine={localTargetLine}
              />
            ))
          )}
          {commenting && commenting.showComments && (
            <OutdatedComments threads={outdated} />
          )}
        </div>
      )}
    </div>
  );
}
