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
  onAction?: (action: FindingActionKind, reply?: string) => void;
  /** "Turn into eval case" (AC-8/9) — separate from onAction since it never
   *  mutates the finding itself, only prefills a new eval case. */
  onCreateEvalCase?: (f: FindingRecord) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const tEval = useTranslations("eval.findingCard");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
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
          </div>
        </div>
      )}
    </div>
  );
}
