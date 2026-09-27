"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResult } from "@devdigest/shared";
import type { VcsUrlRepo } from "@/lib/utils/vcsUrls";
import { SummaryBar } from "./SummaryBar";
import { SymbolList } from "./SymbolList";
import { PriorPrsAccordion } from "./PriorPrsAccordion";
import { BlastGraphLightbox } from "./BlastGraphLightbox";
import { buildCronSet, buildSymbolRows } from "./helpers";

interface BlastRadiusCardProps {
  blastRadius: BlastRadiusResult | undefined;
  isLoading: boolean;
  /** Repo + PR head sha for caller deep-links; links are omitted while absent. */
  repo?: VcsUrlRepo | null;
  headSha?: string | null;
  className?: string;
}

export function BlastRadiusCard({
  blastRadius,
  isLoading,
  repo,
  headSha,
  className = "",
}: BlastRadiusCardProps) {
  const t = useTranslations("prReview.blastRadius");
  const tb = useTranslations("blast");
  const [graphOpen, setGraphOpen] = useState(false);

  if (isLoading) {
    return (
      <div
        className={`border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] p-4 flex items-center justify-center min-h-[280px] h-full ${className}`}
      >
        <span className="text-xs text-[var(--text-muted)]">
          {t("loadingTitle")}
        </span>
      </div>
    );
  }

  if (!blastRadius) {
    return (
      <div
        className={`border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] p-4 flex flex-col items-center justify-center min-h-[280px] h-full gap-2 ${className}`}
      >
        <span className="text-2xl">📡</span>
        <span className="text-sm text-[var(--text-muted)] text-center">
          {t("emptyTitle")}
        </span>
        <span className="text-xs text-[var(--text-muted)] text-center max-w-[220px]">
          {t("emptyBody")}
        </span>
      </div>
    );
  }

  const cronSet = buildCronSet(blastRadius.factsByFile);
  const symbolRows = buildSymbolRows(blastRadius);

  return (
    <div
      className={`border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] p-4 flex flex-col gap-3 min-h-[280px] h-full box-border ${className}`}
    >
      <SummaryBar
        symbolCount={blastRadius.changedSymbols.length}
        callerCount={blastRadius.callers.length}
        endpointCount={blastRadius.impactedEndpoints.length}
        cronCount={cronSet.size}
        degraded={blastRadius.degraded ?? false}
        reason={blastRadius.reason}
        onOpenGraph={() => setGraphOpen(true)}
      />

      {blastRadius.summary && (
        <p className="m-0 text-xs text-[var(--text-secondary)] leading-relaxed">
          {blastRadius.summary}
        </p>
      )}

      {!blastRadius.degraded && blastRadius.callers.length === 0 && (
        <p className="m-0 text-xs text-[var(--text-muted)]">
          {tb("noDownstream", { count: blastRadius.changedSymbols.length })}
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        <SymbolList rows={symbolRows} repo={repo} headSha={headSha} />
      </div>

      <PriorPrsAccordion priorPrs={blastRadius.priorPrs ?? []} />

      {graphOpen && (
        <BlastGraphLightbox
          data={blastRadius}
          onClose={() => setGraphOpen(false)}
        />
      )}
    </div>
  );
}
