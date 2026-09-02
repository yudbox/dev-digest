/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind, FindingReply } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { vcsBlobUrl, type VcsUrlRepo } from "../../../../../../../lib/utils/vcsUrls";
import { s } from "./styles";
import {
  useFindingReplies,
  usePublishFindingReply,
  useEditFindingReply,
  useDeleteFindingReply,
} from "../../../../../../../lib/hooks/reviews";

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function FindingCard({
  f,
  focused,
  targeted,
  defaultExpanded,
  onAction,
  onCreateEvalCase,
  pending,
  repo,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  targeted?: boolean;
  defaultExpanded?: boolean;
  onAction?: (
    action: FindingActionKind,
    extra?: { note?: string; reply?: string },
  ) => void;
  /** "Turn into eval case" — separate from onAction. */
  onCreateEvalCase?: (f: FindingRecord) => void;
  pending?: boolean;
  repo?: VcsUrlRepo | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const tEval = useTranslations("eval.findingCard");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [composer, setComposer] = React.useState<"learn" | null>(null);
  const [composerText, setComposerText] = React.useState("");
  const [threadOpen, setThreadOpen] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingBody, setEditingBody] = React.useState("");

  const { data: threadData, isFetching: threadFetching, refetch: refetchThread } =
    useFindingReplies(threadOpen ? f.id : null);
  const publishReply = usePublishFindingReply();
  const editReply = useEditFindingReply();
  const deleteReply = useDeleteFindingReply();
  const threadReplies = threadData?.replies ?? [];
  const adoThreadUrl = threadData?.ado_thread_url ?? null;

  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repo && headSha
      ? vcsBlobUrl(repo, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  React.useEffect(() => {
    if (targeted) setExpanded(true);
  }, [targeted]);

  const cardRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (targeted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [targeted]);
  const openComposer = (kind: "learn") => {
    setComposerText(f.title);
    setComposer(kind);
  };

  const submitComposer = () => {
    if (!composer || !composerText.trim()) return;
    onAction?.("learn", { note: composerText.trim() });
    setComposer(null);
    setComposerText("");
  };
  return (
    <div
      ref={cardRef}
      data-finding-id={f.id}
      style={s.card(!!focused || !!targeted, sevColor, muted)}
    >
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && (
              <span style={s.acceptedTag}>{t("finding.accepted")}</span>
            )}
            {dismissed && (
              <span style={s.dismissedTag}>{t("finding.dismissed")}</span>
            )}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={pending || dismissed}
              onClick={() => onAction?.("accept")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: accepted ? "default" : "pointer",
                border: accepted
                  ? "1px solid var(--ok)"
                  : "1px solid var(--border)",
                background: accepted
                  ? "color-mix(in srgb, var(--ok) 15%, transparent)"
                  : "transparent",
                color: accepted ? "var(--ok)" : "var(--text-secondary)",
                opacity: dismissed ? 0.4 : 1,
                transition: "all 0.15s",
              }}
            >
              <Icon.Check size={12} />
              {t("finding.accept")}
            </button>
            {accepted && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onAction?.("undo")}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  transition: "all 0.15s",
                }}
                title={t("finding.undo")}
              >
                ↩
              </button>
            )}
            <button
              type="button"
              disabled={pending || accepted}
              onClick={() => onAction?.("dismiss")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: dismissed ? "default" : "pointer",
                border: dismissed
                  ? "1px solid var(--text-muted)"
                  : "1px solid var(--border)",
                background: dismissed
                  ? "color-mix(in srgb, var(--text-muted) 10%, transparent)"
                  : "transparent",
                color: dismissed
                  ? "var(--text-muted)"
                  : "var(--text-secondary)",
                opacity: accepted ? 0.4 : 1,
                transition: "all 0.15s",
              }}
            >
              <Icon.X size={12} />
              {t("finding.dismiss")}
            </button>
            {dismissed && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onAction?.("undo")}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  transition: "all 0.15s",
                }}
                title={t("finding.undo")}
              >
                ↩
              </button>
            )}
            {onCreateEvalCase && (
              <Button
                kind="ghost"
                size="sm"
                icon="FlaskConical"
                disabled={!muted}
                title={!muted ? tEval("turnIntoEvalCaseHint") : undefined}
                onClick={() => onCreateEvalCase(f)}
              >
                {tEval("turnIntoEvalCase")}
              </Button>
            )}

            {/* Learn button — embeds note as a memory row */}
            <button
              type="button"
              disabled={pending}
              onClick={() => openComposer("learn")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                transition: "all 0.15s",
              }}
            >
              <Icon.Brain size={12} />
              Learn
            </button>

            {/* Thread toggle button */}
            <button
              type="button"
              onClick={() => setThreadOpen((o) => !o)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                border: threadOpen ? "1px solid var(--accent, #4f9cf9)" : "1px solid var(--border)",
                background: threadOpen ? "color-mix(in srgb, var(--accent, #4f9cf9) 12%, transparent)" : "transparent",
                color: threadOpen ? "var(--accent, #4f9cf9)" : "var(--text-secondary)",
                transition: "all 0.15s",
              }}
            >
              <Icon.MessageSquare size={12} />
              Thread{threadReplies.length > 0 ? ` (${threadReplies.length})` : ""}
            </button>
          </div>

          {/* Inline composer for Learn / Reply */}
          {composer && (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: "var(--surface)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 6 }}>
                What did you learn? (pre-filled from title)
              </div>
              <textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--surface-raised)",
                  color: "var(--text)",
                  fontSize: 13,
                  padding: "6px 8px",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setComposer(null)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: "pointer",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-muted)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!composerText.trim() || pending}
                  onClick={submitComposer}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: composerText.trim() ? "pointer" : "not-allowed",
                    border: "none",
                    background: composerText.trim() ? "var(--accent, #4f9cf9)" : "var(--surface)",
                    color: composerText.trim() ? "#fff" : "var(--text-muted)",
                  }}
                >
                  Learn
                </button>
              </div>
            </div>
          )}

          {/* Thread panel — stored replies */}
          {threadOpen && (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: "var(--surface)",
                borderRadius: 8,
                border: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Thread
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {adoThreadUrl && (
                    <a
                      href={adoThreadUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11, color: "var(--accent, #4f9cf9)", textDecoration: "none" }}
                    >
                      Open in ADO ↗
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => refetchThread()}
                    disabled={threadFetching}
                    title="Refresh"
                    style={{
                      padding: "2px 7px",
                      borderRadius: 4,
                      fontSize: 13,
                      cursor: threadFetching ? "wait" : "pointer",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-muted)",
                      opacity: threadFetching ? 0.5 : 1,
                    }}
                  >
                    ↻
                  </button>
                </div>
              </div>

              {/* Reply list */}
              {threadReplies.length === 0 && !threadFetching && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "4px 0" }}>
                  No replies yet
                </div>
              )}
              {threadReplies.map((reply: FindingReply) => (
                <div
                  key={reply.id}
                  style={{
                    padding: "8px 10px",
                    background: "var(--surface-raised)",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
                        {reply.author.includes("@") ? reply.author.split("@")[0] : reply.author}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {formatRelativeTime(reply.created_at)}
                      </span>
                      {reply.updated_at !== reply.created_at && (
                        <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>edited</span>
                      )}
                    </div>
                    {reply.is_own && editingId !== reply.id && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => { setEditingId(reply.id); setEditingBody(reply.body); }}
                          style={{ padding: "1px 6px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)" }}
                        >✎</button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => {
                            if (window.confirm("Delete this comment from the thread?")) {
                              deleteReply.mutate({ findingId: f.id, replyId: reply.id });
                            }
                          }}
                          style={{ padding: "1px 6px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)" }}
                        >✕</button>
                      </div>
                    )}
                  </div>

                  {editingId === reply.id ? (
                    <div>
                      <textarea
                        value={editingBody}
                        onChange={(e) => setEditingBody(e.target.value)}
                        rows={3}
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--surface-raised)",
                          color: "var(--text)",
                          fontSize: 13,
                          padding: "6px 8px",
                          resize: "vertical",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 4, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          style={{ padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)" }}
                        >Cancel</button>
                        <button
                          type="button"
                          disabled={!editingBody.trim() || editReply.isPending}
                          onClick={() =>
                            editReply.mutate(
                              { findingId: f.id, replyId: reply.id, body: editingBody.trim() },
                              { onSuccess: () => setEditingId(null) },
                            )
                          }
                          style={{
                            padding: "3px 10px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: editingBody.trim() && !editReply.isPending ? "pointer" : "not-allowed",
                            border: "none",
                            background: editingBody.trim() ? "var(--accent, #4f9cf9)" : "var(--surface)",
                            color: editingBody.trim() ? "#fff" : "var(--text-muted)",
                          }}
                        >Save</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {reply.body}
                    </div>
                  )}
                </div>
              ))}

              {/* Add reply */}
              <div style={{ borderTop: threadReplies.length > 0 ? "1px solid var(--border)" : "none", paddingTop: threadReplies.length > 0 ? 8 : 0 }}>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Add a reply to this thread…"
                  rows={2}
                  style={{
                    width: "100%",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--surface-raised)",
                    color: "var(--text)",
                    fontSize: 13,
                    padding: "6px 8px",
                    resize: "vertical",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <button
                    type="button"
                    disabled={!replyText.trim() || publishReply.isPending}
                    onClick={() =>
                      publishReply.mutate(
                        { findingId: f.id, body: replyText.trim() },
                        { onSuccess: () => setReplyText("") },
                      )
                    }
                    style={{
                      padding: "4px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: replyText.trim() && !publishReply.isPending ? "pointer" : "not-allowed",
                      border: "none",
                      background: replyText.trim() ? "var(--accent, #4f9cf9)" : "var(--surface)",
                      color: replyText.trim() ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {publishReply.isPending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
