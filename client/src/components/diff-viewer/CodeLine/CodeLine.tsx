/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, an inline composer, and
   (SPEC-2026-09-23-smart-diff-hw3-upgrade) one stacked FindingMarker per
   finding on this line with its InlineFindingCard opening in place below. */
"use client";

import React from "react";
import {
  commentTargetFor,
  type CommentThread,
  type DiffCommentApi,
  cs,
} from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";
import { FindingMarker } from "../FindingMarker";
import { InlineFindingCard } from "../InlineFindingCard";
import { mostSevereActive, type DiffFindingsApi } from "../findings";
import type { FindingRecord } from "@devdigest/shared";
import { SEV } from "@devdigest/ui";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  lineFindings,
  findings,
  targetLine,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Findings anchored to this rendered line (already resolved by FileCard —
   *  never present on a line with no new-side line number, AC-30). */
  lineFindings?: FindingRecord[];
  findings?: DiffFindingsApi;
  targetLine?: number;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  // Cards closed by default; independent per finding, on this line only
  // (AC-21). Not reset by `showComments` — markers/cards are never gated by
  // it (AC-19).
  const [openIds, setOpenIds] = React.useState<Set<string>>(new Set());

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const lineNo = ln.newNo ?? ln.oldNo;
  const isTarget = targetLine !== undefined && lineNo === targetLine;

  const toggleFinding = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openFindings = (lineFindings ?? []).filter((f) => openIds.has(f.id));

  // Full-width row tint for a line that carries findings: a 3px severity bar on
  // the left + a translucent severity background, coloured by the line's most
  // severe ACTIVE finding. Accepted-only lines keep a neutral bar, no tint.
  const tintFinding =
    lineFindings && lineFindings.length > 0 ? mostSevereActive(lineFindings) : null;
  const rowTint: React.CSSProperties =
    tintFinding && SEV[tintFinding.severity]
      ? {
          borderLeft: `3px solid ${SEV[tintFinding.severity].c}`,
          background: SEV[tintFinding.severity].bg,
        }
      : lineFindings && lineFindings.length > 0
        ? { borderLeft: "3px solid var(--border)" }
        : {};

  return (
    <div
      id={isTarget ? `diff-line-${path}-${lineNo}` : undefined}
      style={cs.rowWrap}
      data-line={lineNo}
      data-path={path}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          ...lineRowFor(ln.kind),
          ...(isTarget
            ? {
                background: "var(--accent-bg)",
                outline: "1px solid var(--accent-text)",
              }
            : {}),
          ...rowTint,
        }}
      >
        <span
          className="mono tnum"
          style={{ ...s.lineNo, position: "relative" }}
        >
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {lineFindings && lineFindings.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 8 }}>
            {lineFindings.map((f) => (
              <FindingMarker
                key={f.id}
                f={f}
                open={openIds.has(f.id)}
                onClick={() => toggleFinding(f.id)}
              />
            ))}
          </div>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView
            key={th.rootId}
            thread={th}
            commenting={commenting}
            path={path}
          />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}

      {findings &&
        openFindings.map((f) => (
          <div key={f.id} style={{ margin: "6px 14px 8px 58px" }}>
            <InlineFindingCard f={f} api={findings} />
          </div>
        ))}
    </div>
  );
}
