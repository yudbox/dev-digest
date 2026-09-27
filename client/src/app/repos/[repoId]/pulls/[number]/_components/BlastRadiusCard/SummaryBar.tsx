"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastDegradedReason } from "@devdigest/shared";

interface SummaryBarProps {
  symbolCount: number;
  callerCount: number;
  endpointCount: number;
  cronCount: number;
  degraded: boolean;
  reason?: BlastDegradedReason;
  onOpenGraph: () => void;
}

export function SummaryBar({
  symbolCount,
  callerCount,
  endpointCount,
  cronCount,
  degraded,
  reason,
  onOpenGraph,
}: SummaryBarProps) {
  const t = useTranslations("prReview.blastRadius");
  const tb = useTranslations("blast");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-[var(--text-muted)]">
        {symbolCount} {tb("stat.symbols")}
      </span>
      <span className="text-xs text-[var(--text-muted)]">
        {callerCount} {tb("stat.callers")}
      </span>
      <span className="text-xs text-indigo-400">
        {endpointCount} {tb("stat.endpoints")}
      </span>
      <span className="text-xs text-amber-400">
        {cronCount} {tb("stat.crons")}
      </span>
      {degraded && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/15 text-red-400 font-semibold uppercase tracking-wide">
          {t("degraded")}
        </span>
      )}
      {degraded && (
        <span className="text-[11px] text-red-400">
          {tb(`degradedReason.${reason ?? "no_data"}`)}
        </span>
      )}
      <button
        onClick={onOpenGraph}
        className="ml-auto text-[11px] px-2 py-0.5 rounded border border-[var(--border)] cursor-pointer text-[var(--text-muted)] bg-transparent hover:text-[var(--text-primary)] transition-colors"
      >
        {t("openGraph")}
      </button>
    </div>
  );
}
