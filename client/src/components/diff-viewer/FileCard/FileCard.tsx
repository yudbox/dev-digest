/* FileCard — one collapsible file in the diff: header (path, finding dot,
   +/- stat, comment count) and, when open, its parsed lines, any outdated
   comments, and an end-of-file block for findings that aren't on a rendered
   new-side line (AC-29). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
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
import { UnanchoredFindings } from "../UnanchoredFindings";
import { SeverityChip } from "@/components/SeverityChip/SeverityChip";
import {
  hasActive,
  isActive,
  mostSevereActive,
  splitByRenderedLines,
  type DiffFindingsApi,
} from "../findings";

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
  findings,
  targetLine,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  initialOpen?: boolean;
  /** Every finding of this file from the smart-diff response (single source
   *  of truth, AC-31) — `undefined` when smart-diff hasn't loaded/failed. */
  findings?: DiffFindingsApi;
  targetLine?: number;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    initialOpen ??
      (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES,
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  const fileFindings = React.useMemo(
    () => findings?.byFile.get(file.path) ?? [],
    [findings, file.path],
  );

  // Rendered new-side line numbers (added + context lines) — markers only
  // ever attach here (AC-30); a deleted line never gets one even if its old
  // line number equals a finding's start_line.
  const renderedNewLines = React.useMemo(() => {
    const set = new Set<number>();
    for (const ln of lines) if (ln.newNo != null) set.add(ln.newNo);
    return set;
  }, [lines]);

  const { byLine: findingsByLine, unanchored } = React.useMemo(
    () => splitByRenderedLines(fileFindings, renderedNewLines),
    [fileFindings, renderedNewLines],
  );

  const fileHasActive = hasActive(fileFindings);
  // Same Show/Hide switch as GitHub comments hides the inline annotations only;
  // the header dot + severity chips stay so the reviewer still sees where
  // findings are.
  const showInline = findings?.showInline !== false;
  const dotColor = React.useMemo(() => {
    const worst = mostSevereActive(fileFindings);
    return worst ? SEV[worst.severity].c : null;
  }, [fileFindings]);

  // One count + jump-target line per severity present among ACTIVE findings —
  // reuses the same SeverityChip already used for run-level counts, scoped to
  // this file's active findings (AC-17; accepted findings don't count).
  const severityGroups = React.useMemo(() => {
    const active = fileFindings.filter(isActive);
    if (active.length === 0) return null;
    const groups = {} as Record<
      (typeof JUMPABLE_SEVERITIES)[number],
      { count: number; line: number }
    >;
    for (const f of active) {
      if (!JUMPABLE_SEVERITIES.includes(f.severity as never)) continue;
      const sev = f.severity as (typeof JUMPABLE_SEVERITIES)[number];
      const existing = groups[sev];
      if (existing) {
        existing.count += 1;
        existing.line = Math.min(existing.line, f.start_line);
      } else {
        groups[sev] = { count: 1, line: f.start_line };
      }
    }
    return Object.keys(groups).length > 0 ? groups : null;
  }, [fileFindings]);

  // Locally-controlled scroll target: starts from the URL-driven `targetLine`
  // prop, but can be overridden by clicking one of the severity chips below.
  const [localTargetLine, setLocalTargetLine] = React.useState(targetLine);
  React.useEffect(() => setLocalTargetLine(targetLine), [targetLine]);
  // Bumped on every chip click so a repeat click scrolls again even when the
  // file is already open and the target line hasn't changed (otherwise the
  // effect below has no changed dependency and silently does nothing).
  const [jumpRequest, setJumpRequest] = React.useState(0);

  React.useEffect(() => {
    if (!open || localTargetLine === undefined) return;
    const id = `diff-line-${file.path}-${localTargetLine}`;
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, localTargetLine, file.path, jumpRequest]);

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
        {dotColor && fileHasActive && (
          <span
            data-testid="file-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: dotColor,
              flexShrink: 0,
            }}
          />
        )}
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
                    if (findings?.showInline === false) findings.onRevealInline?.();
                    setOpen(true);
                    setLocalTargetLine(group.line);
                    setJumpRequest((n) => n + 1);
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
                lineFindings={
                  showInline && ln.newNo != null
                    ? findingsByLine.get(ln.newNo)
                    : undefined
                }
                findings={findings}
                targetLine={localTargetLine}
              />
            ))
          )}
          {commenting && commenting.showComments && (
            <OutdatedComments threads={outdated} />
          )}
          {findings && showInline && unanchored.length > 0 && (
            <UnanchoredFindings findings={unanchored} api={findings} />
          )}
        </div>
      )}
    </div>
  );
}
