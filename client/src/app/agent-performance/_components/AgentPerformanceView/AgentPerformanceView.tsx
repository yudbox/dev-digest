/* /agent-performance — which agents earn their keep. Reads stored runs and
   findings only: opening, reloading, changing the period, sorting and expanding
   never start a review or a model call. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { PeriodHeader, StatsEmpty, StatsError, StatsSkeleton } from "@/components/stats";
import { useAgentPerformance } from "@/lib/hooks/performance";
import { AgentTable } from "./AgentTable";
import { CostBreakdown } from "./CostBreakdown";
import { KpiRow } from "./KpiRow";

export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const { data, isPending, isError, refetch } = useAgentPerformance();

  // The workspace has never run an agent: nothing to scope by period, so the
  // whole page is one text-only empty state.
  const neverRan = data !== undefined && !data.hasAnyRuns;
  const noRunsInWindow = data !== undefined && data.hasAnyRuns && data.kpis.totalRuns === 0;

  return (
    <AppShell crumb={[{ label: t("crumb") }]}>
      <div style={{ padding: "20px 28px 40px", maxWidth: 1000, margin: "0 auto" }}>
        {neverRan ? (
          <div data-testid="empty-never-ran">
            <StatsEmpty title={t("empty.neverTitle")} body={t("empty.neverBody")} />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 18 }}>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("title")}</h1>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3 }}>{t("subtitle")}</p>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <PeriodHeader window={data?.window} showSyncCi={data?.hasCiInstallations === true} />
              </div>
            </div>

            {isError ? (
              <StatsError onRetry={() => void refetch()} />
            ) : isPending || data === undefined ? (
              <StatsSkeleton />
            ) : noRunsInWindow ? (
              <div data-testid="empty-no-runs-in-window">
                <StatsEmpty
                  title={
                    data.window.kind === "custom"
                      ? t("empty.windowTitleCustom")
                      : t("empty.windowTitleDays", { days: data.window.days })
                  }
                  body={t("empty.windowBody")}
                />
              </div>
            ) : (
              <>
                <KpiRow data={data} />
                <AgentTable rows={data.agents} window={data.window} />
                <CostBreakdown
                  byAgent={data.costByAgent}
                  byModel={data.costByModel}
                  totalCostUsd={data.kpis.totalCostUsd}
                  source={data.kpis.costSource}
                />
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
