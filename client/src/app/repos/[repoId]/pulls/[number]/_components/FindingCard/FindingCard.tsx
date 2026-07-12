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
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/utils/githubUrls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  targeted,
  defaultExpanded,
  onAction,
  onCreateEvalCase,
  pending,
  repoFullName,
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
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const tEval = useTranslations("eval.findingCard");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [composer, setComposer] = React.useState<"learn" | "reply" | null>(
    null,
  );
  const [composerText, setComposerText] = React.useState("");
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  React.useEffect(() => {
    if (targeted) setExpanded(true);
  }, [targeted]);

  const openComposer = (kind: "learn" | "reply") => {
    setComposerText(kind === "learn" ? f.title : "");
    setComposer(kind);
  };

  const submitComposer = () => {
    if (!composer || !composerText.trim()) return;
    if (composer === "learn") {
      onAction?.("learn", { note: composerText.trim() });
    } else {
      onAction?.("reply", { reply: composerText.trim() });
    }
    setComposer(null);
    setComposerText("");
  };
  return (
    <div
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

            {/* Reply button — sets findings.repliedAt + posts GH comment */}
            <button
              type="button"
              disabled={pending}
              onClick={() => openComposer("reply")}
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
              <Icon.MessageSquare size={12} />
              Reply to author
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
                {composer === "learn" ? "What did you learn? (pre-filled from title)" : "Reply to author"}
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
                  {composer === "learn" ? "Learn" : "Send reply"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
