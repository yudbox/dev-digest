"use client";

import React from "react";
import { CircularScore, Icon, Sparkline } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { AgentStatsResponse } from "@devdigest/shared";
import {
  AcceptRateValue,
  CostSourceBadge,
  KpiCard,
  RunsWithoutCost,
  formatSeconds,
  formatUsd,
} from "@/components/stats";
import { formatBucketTooltip } from "@/lib/utils/period";

function Delta({ value }: { value: number }) {
  const cheaper = value < 0;
  const Arrow = cheaper ? Icon.ArrowDown : Icon.ArrowUp;
  return (
    <span
      data-testid="avg-cost-delta"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        fontSize: 13,
        fontWeight: 600,
        color: value === 0 ? "var(--text-muted)" : cheaper ? "var(--ok)" : "var(--crit)",
      }}
    >
      {value !== 0 && <Arrow size={12} />}
      <span className="tnum">{`${cheaper ? "-" : value > 0 ? "+" : ""}${formatUsd(Math.abs(value))}`}</span>
    </span>
  );
}

/** The four headline numbers of one agent for the selected period. */
export function KpiRow({ data }: { data: AgentStatsResponse }) {
  const t = useTranslations("agents.stats.kpi");
  const ts = useTranslations("stats");
  const { kpis, window } = data;
  const pct = kpis.accept.resolved > 0 ? Math.round((kpis.accept.accepted / kpis.accept.resolved) * 100) : null;

  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
      <KpiCard label={t("totalRuns")} value={kpis.runs} testId="kpi-runs">
        <Sparkline
          data={kpis.sparkline}
          w={160}
          h={28}
          pointTitles={window.buckets.map((b) => formatBucketTooltip(b, window.bucketKind, window.tz, ts))}
        />
      </KpiCard>

      <KpiCard
        label={t("avgCost")}
        testId="kpi-avg-cost"
        value={
          <>
            {formatUsd(kpis.avgCostUsd)}
            {kpis.avgCostDeltaUsd !== null && <Delta value={kpis.avgCostDeltaUsd} />}
          </>
        }
        valueTitle={kpis.avgCostDeltaUsd === null ? t("noHistory") : t("deltaTip")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <CostSourceBadge source={kpis.costSource} />
          <RunsWithoutCost count={kpis.runsWithoutCost} />
        </div>
      </KpiCard>

      <KpiCard label={t("avgDuration")} testId="kpi-avg-duration" value={formatSeconds(kpis.avgDurationMs)} />

      <KpiCard
        label={t("acceptRate")}
        testId="kpi-accept"
        value={<AcceptRateValue accepted={kpis.accept.accepted} resolved={kpis.accept.resolved} size={20} caption />}
        aside={pct !== null ? <CircularScore score={pct} size={34} stroke={4} /> : undefined}
      />
    </div>
  );
}
