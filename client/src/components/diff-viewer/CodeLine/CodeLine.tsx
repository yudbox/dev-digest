/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
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

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  CRITICAL:   { color: '#ef4444', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', paddingLeft: 8, userSelect: 'none' },
  WARNING:    { color: '#f97316', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', paddingLeft: 8, userSelect: 'none' },
  SUGGESTION: { color: '#3b82f6', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', paddingLeft: 8, userSelect: 'none' },
};
const BADGE_LABEL: Record<string, string> = {
  CRITICAL: '⊘ blocker',
  WARNING: '△ warning',
  SUGGESTION: '◇ suggestion',
};
const BADGE_BORDER: Record<string, string> = {
  CRITICAL:   '#ef4444',
  WARNING:    '#f97316',
  SUGGESTION: '#3b82f6',
};
const BADGE_BG: Record<string, string> = {
  CRITICAL:   'rgba(239, 68, 68, 0.06)',
  WARNING:    'rgba(249, 115, 22, 0.06)',
  SUGGESTION: 'rgba(59, 130, 246, 0.06)',
};

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  badge,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  badge?: string;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

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

  return (
    <div
      style={cs.rowWrap}
      data-line={ln.newNo ?? ln.oldNo}
      data-path={path}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{
        ...lineRowFor(ln.kind),
        ...(badge && BADGE_BORDER[badge] ? {
          borderLeft: `3px solid ${BADGE_BORDER[badge]}`,
          background: BADGE_BG[badge],
        } : {}),
      }}>
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
        {badge && BADGE_STYLE[badge] && (
          <span style={BADGE_STYLE[badge]}>
            {BADGE_LABEL[badge] ?? badge.toLowerCase()}
          </span>
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
    </div>
  );
}
