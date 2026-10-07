"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import type { Brief } from "@devdigest/shared";
import type { RunSummary, ReviewRecord } from "@devdigest/shared";
import { VERDICT_META } from "../VerdictBanner/constants";
import { s } from "./styles";
import { RISK_LEVEL_META } from "./constants";
import { buildFileRefUrl } from "./helpers";

// ---- Main BriefCard --------------------------------------------------------
interface BriefCardProps {
  brief: Brief | null | undefined;
  isLoading: boolean;
  isError: boolean;
  latestRun?: RunSummary | null;
  latestReview?: Pick<ReviewRecord, "verdict"> | null;
  prId: string;
  repoId: string;
  prNumber: string;
  onRegenerate: () => void;
  regenerating: boolean;
}

export function BriefCard({
  brief,
  isLoading,
  isError,
  latestRun,
  latestReview,
  prId,
  repoId,
  prNumber,
  onRegenerate,
  regenerating,
}: BriefCardProps) {
  const t = useTranslations("brief");
  const tReview = useTranslations("prReview");
  const router = useRouter();
  const pathname = usePathname();

  const handleNavigate = (ref: string) => {
    router.push(
      pathname + "?" + buildFileRefUrl(repoId, prNumber, ref).split("?")[1],
    );
  };

  if (isLoading || regenerating) {
    return (
      <div style={s.loadingCard}>
        <span style={s.loadingText}>{t("loading")}</span>
      </div>
    );
  }

  // A failed generation (flaky model / bad structured output) is logged for
  // debugging but not surfaced as an alarming error card — it happens
  // occasionally with weaker models and isn't worth interrupting the PR page.
  // The user can still retry via the Regenerate button once a brief exists.
  if (isError) {
    // eslint-disable-next-line no-console
    console.error(
      "[BriefCard] Brief generation failed — check server logs for the LLM error.",
    );
    return null;
  }

  if (!brief) {
    return (
      <div style={s.errorCard}>
        <span style={s.errorText}>{t("error")}</span>
        <button type="button" onClick={onRegenerate} style={s.regenerateBtn}>
          {t("generate")}
        </button>
      </div>
    );
  }

  const hasRun = latestRun?.status === "done";
  const verdict = latestReview?.verdict ?? null;
  const verdictMeta = verdict ? VERDICT_META[verdict] : null;
  const { c, bg, icon, labelKey } = RISK_LEVEL_META[brief.risk_level];
  const RiskLevelIcon = Icon[icon] as React.FC<{ size?: number }>;

  return (
    <div style={s.card}>
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Left: verdict icon box OR risk level badge */}
        {verdictMeta ? (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: verdictMeta.bg,
              color: verdictMeta.c,
              flexShrink: 0,
            }}
          >
            {React.createElement(
              Icon[verdictMeta.icon] as React.FC<{ size?: number }>,
              { size: 22 },
            )}
          </div>
        ) : (
          <span style={{ ...s.banner(c, bg), alignSelf: "center" }}>
            <RiskLevelIcon size={12} />
            {t(`riskLevel.${labelKey}`)}
          </span>
        )}

        {/* Centre: title + findings + summary */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {verdictMeta && (
              <span
                style={{ fontSize: 16, fontWeight: 700, color: verdictMeta.c }}
              >
                {tReview(`verdict.${verdictMeta.labelKey}`)}
              </span>
            )}
            {hasRun && latestRun!.findings_count != null && (
              <Badge color="var(--text-secondary)">
                {latestRun!.findings_count} findings
                {latestRun!.blockers != null && latestRun!.blockers > 0
                  ? ` · ${latestRun!.blockers} blockers`
                  : ""}
              </Badge>
            )}
          </div>
          <p style={{ ...s.what, marginTop: 6 }}>{brief.what}</p>
          {brief.why && <p style={{ ...s.why, marginTop: 4 }}>{brief.why}</p>}
        </div>

        {/* Right: regenerate + score */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            title={t("regenerate")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 18,
              lineHeight: 1,
              padding: "2px 4px",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              opacity: regenerating ? 0.4 : 1,
            }}
          >
            <Icon.RefreshCw size={16} />
          </button>
          {hasRun && latestRun!.score != null && (
            <>
              <CircularScore score={latestRun!.score} size={52} stroke={5} />
              <span style={s.scoreLabel}>PR SCORE</span>
            </>
          )}
        </div>
      </div>

      {/* ── Cost / tokens row ──────────────────────────────────────────── */}
      {hasRun &&
        (latestRun!.cost_usd != null || latestRun!.tokens_in != null) && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {latestRun!.cost_usd != null && (
              <span>
                <span style={{ opacity: 0.6 }}>$</span>{" "}
                <span style={{ color: "var(--ok)" }}>
                  ${latestRun!.cost_usd.toFixed(3)}
                </span>
              </span>
            )}
            {latestRun!.tokens_in != null && (
              <span style={{ color: "var(--text-muted)" }}>
                {Math.round(latestRun!.tokens_in / 100) / 10}K→
                {Math.round((latestRun!.tokens_out ?? 0) / 100) / 10}K
              </span>
            )}
          </div>
        )}

      {/* ── Nudge when no run ─────────────────────────────────────────── */}
      {!hasRun && (
        <div style={s.nudge}>
          <span style={s.nudgeText}>{t("noRunYet")}</span>
          <RunReviewDropdownInline prId={prId} />
        </div>
      )}
    </div>
  );
}

// Inline wrapper to avoid adding page.tsx prop
function RunReviewDropdownInline({ prId }: { prId: string }) {
  const {
    RunReviewDropdown,
  } = require("../RunReviewDropdown/RunReviewDropdown");
  return <RunReviewDropdown prId={prId} size="sm" kind="secondary" />;
}
