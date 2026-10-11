"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ACCEPT_GOOD_PCT, SMALL_SAMPLE_DECISIONS } from "./constants";
import { SmallSampleBadge } from "./badges";
import { formatAccept } from "./format";

/**
 * An accept rate, always with its denominator ("75% (30/40)"), coloured by
 * quality, with a "small sample" mark under 5 decisions. No decisions → "—",
 * never "0%": nobody has judged anything yet.
 */
export function AcceptRateValue({
  accepted,
  resolved,
  size = 13,
  caption = false,
  localFindings,
}: {
  accepted: number;
  resolved: number;
  size?: number;
  /** Show "based on N local findings" under the value (KPI cards). */
  caption?: boolean;
  localFindings?: number;
}) {
  const t = useTranslations("stats");
  const pct = resolved > 0 ? Math.round((accepted / resolved) * 100) : null;
  const color = pct === null ? "var(--text-muted)" : pct >= ACCEPT_GOOD_PCT ? "var(--ok)" : "var(--warn)";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span className="tnum" data-testid="accept-value" style={{ fontSize: size, fontWeight: 600, color }}>
          {formatAccept(accepted, resolved)}
        </span>
        {resolved > 0 && resolved < SMALL_SAMPLE_DECISIONS && <SmallSampleBadge />}
      </span>
      {caption && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {t("accept.caption", { count: localFindings ?? resolved })}
        </span>
      )}
    </span>
  );
}
