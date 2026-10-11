"use client";

import React from "react";
import { CircularScore, Icon, Sparkline } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { AgentPerformanceResponse } from "@devdigest/shared";
import {
  AcceptRateValue,
  AgentIcon,
  CostSourceBadge,
  KpiCard,
  RunsWithoutCost,
  formatUsd,
} from "@/components/stats";
import { formatBucketTooltip } from "@/lib/utils/period";

/** Signed money delta: cheaper (negative) is good (green), costlier is bad (red). */
function CostDelta({ delta }: { delta: number }) {
  const cheaper = delta < 0;
  const flat = delta === 0;
  const Arrow = cheaper ? Icon.ArrowDown : Icon.ArrowUp;
  return (
    <span
      data-testid="cost-delta"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        fontSize: 13,
        fontWeight: 600,
        color: flat ? "var(--text-muted)" : cheaper ? "var(--ok)" : "var(--crit)",
      }}
    >
      {!flat && <Arrow size={12} />}
      <span className="tnum">{`${cheaper ? "-" : delta > 0 ? "+" : ""}${formatUsd(Math.abs(delta))}`}</span>
    </span>
  );
}

export function KpiRow({ data }: { data: AgentPerformanceResponse }) {
  const t = useTranslations("agentPerformance.kpi");
  const ts = useTranslations("stats");
  const { kpis, window } = data;
  const acceptPct = kpis.accept.resolved > 0 ? Math.round((kpis.accept.accepted / kpis.accept.resolved) * 100) : null;
  const top = kpis.mostActive;
  const topAccept = top && top.accept.resolved > 0 ? `${Math.round((top.accept.accepted / top.accept.resolved) * 100)}%` : null;

  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
      <KpiCard label={t("totalRuns")} value={kpis.totalRuns} testId="kpi-total-runs">
        <Sparkline
          data={kpis.sparkline}
          w={200}
          h={28}
          pointTitles={window.buckets.map((b) => formatBucketTooltip(b, window.bucketKind, window.tz, ts))}
        />
      </KpiCard>

      <KpiCard
        label={t("totalCost")}
        testId="kpi-total-cost"
        value={
          <>
            {formatUsd(kpis.totalCostUsd)}
            {kpis.costDeltaUsd !== null && <CostDelta delta={kpis.costDeltaUsd} />}
          </>
        }
        valueTitle={kpis.costDeltaUsd === null ? t("noHistory") : t("costDeltaTip")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <CostSourceBadge source={kpis.costSource} />
          <RunsWithoutCost count={kpis.runsWithoutCost} />
        </div>
      </KpiCard>

      <KpiCard
        label={t("avgAccept")}
        testId="kpi-avg-accept"
        value={<AcceptRateValue accepted={kpis.accept.accepted} resolved={kpis.accept.resolved} size={20} caption />}
        aside={acceptPct !== null ? <CircularScore score={acceptPct} size={34} stroke={4} /> : undefined}
      />

      <KpiCard
        label={t("mostActive")}
        testId="kpi-most-active"
        value={
          top ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
              <AgentIcon id={top.agentId} />
              <span style={{ display: "grid" }}>
                <span>{top.name}</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>
                  {topAccept
                    ? t("mostActiveCaption", { runs: top.runs, accept: topAccept })
                    : t("mostActiveCaptionNoAccept", { runs: top.runs })}
                </span>
              </span>
            </span>
          ) : (
            "—"
          )
        }
      />
    </div>
  );
}
