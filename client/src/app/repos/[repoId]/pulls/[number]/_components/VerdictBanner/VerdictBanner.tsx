/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { VERDICT_META } from "./constants";
import { s } from "./styles";

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  agentName,
  durationMs,
  costUsd,
  onViewTrace,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
  /** Optional: elapsed time for this agent run (shown in multi-agent detail). */
  durationMs?: number | null;
  /** Optional: cost for this agent run. */
  costUsd?: number | null;
  /** Optional: callback to open the run trace drawer. */
  onViewTrace?: () => void;
}) {
  const t = useTranslations("prReview");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];
  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          <Badge color="var(--text-secondary)">
            {t("verdict.findingsCount", { count: findingsCount })}
            {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
          </Badge>
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
        </div>
        {summary && <p style={s.summary}>{summary}</p>}
        {/* Optional time/cost/trace row (multi-agent detail only) */}
        {(durationMs != null || costUsd != null || onViewTrace) && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            {durationMs != null && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {(durationMs / 1000).toFixed(1)}s
              </span>
            )}
            {costUsd != null && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                ${costUsd.toFixed(3)}
              </span>
            )}
            {onViewTrace && (
              <button
                type="button"
                onClick={onViewTrace}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--accent-text, #4f9cf9)",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                View trace →
              </button>
            )}
          </div>
        )}
      </div>
      {score != null && (
        <div style={s.scoreCol}>
          <CircularScore score={score} size={52} stroke={5} />
          <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
        </div>
      )}
    </div>
  );
}
