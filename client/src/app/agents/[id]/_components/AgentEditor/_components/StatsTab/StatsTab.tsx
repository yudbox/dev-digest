/* Agent Editor → Stats. One agent's numbers for the global period. Reads stored
   runs and findings only — never starts a review or a model call. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { PeriodHeader, StatsEmpty, StatsError, StatsSkeleton } from "@/components/stats";
import { useAgentStats } from "@/lib/hooks/performance";
import { CategoryCard, SeverityCard } from "./FindingsCards";
import { KpiRow } from "./KpiRow";
import { RunHistory } from "./RunHistory";
import { MemoryCard, SkillsCard } from "./UsageCards";

export function StatsTab({ agentId, agentName }: { agentId: string; agentName: string }) {
  const t = useTranslations("agents.stats");
  const { data, isPending, isError, refetch } = useAgentStats(agentId);

  // This agent has never run: nothing to scope by period.
  if (data && !data.hasAnyRuns) {
    return (
      <div data-testid="stats-never-ran" style={{ padding: "24px 28px" }}>
        <StatsEmpty title={t("neverTitle")} body={t("neverBody")} />
      </div>
    );
  }

  const noRunsInPeriod = data !== undefined && data.kpis.runs === 0;

  return (
    <div style={{ padding: "20px 28px 40px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <PeriodHeader window={data?.window} showSyncCi={data?.hasCiInstallations === true} />
      </div>

      {isError ? (
        <StatsError onRetry={() => void refetch()} />
      ) : isPending || !data ? (
        <StatsSkeleton cards={4} rows={3} />
      ) : noRunsInPeriod ? (
        <div data-testid="stats-no-runs">
          <StatsEmpty title={t("noRunsTitle")} body={t("noRunsBody")} />
        </div>
      ) : (
        <>
          <KpiRow data={data} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <SkillsCard data={data} />
            <MemoryCard data={data} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <SeverityCard data={data} />
            <CategoryCard data={data} />
          </div>
          <RunHistory agentId={agentId} agentName={agentName} />
        </>
      )}
    </div>
  );
}
