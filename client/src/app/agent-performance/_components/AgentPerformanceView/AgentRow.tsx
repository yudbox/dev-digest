"use client";

import React from "react";
import { Badge, Icon, Sparkline } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { AgentPerfRow, StatsWindow } from "@devdigest/shared";
import {
  AcceptRateValue,
  AgentIcon,
  CostSourceBadge,
  formatRelative,
  formatSeconds,
  formatTimestamp,
  formatUsd,
} from "@/components/stats";
import { GRID } from "./constants";
import { acceptTrend } from "./helpers";

function previousPeriodLabel(window: StatsWindow, t: ReturnType<typeof useTranslations>): string {
  return window.kind === "1d" || window.days === 1 ? t("previous.oneDay") : t("previous.days", { count: window.days });
}

/** The ↑ / ↓ next to an accept rate, with a tooltip that explains it (or its absence). */
function AcceptArrow({ row, window }: { row: AgentPerfRow; window: StatsWindow }) {
  const t = useTranslations("agentPerformance");
  const trend = acceptTrend(row);

  if (trend.kind === "up" || trend.kind === "down") {
    const Arrow = trend.kind === "up" ? Icon.ArrowUp : Icon.ArrowDown;
    const pct = Math.round((trend.was.accepted / trend.was.resolved) * 100);
    return (
      <span
        data-testid="accept-arrow"
        data-direction={trend.kind}
        title={t("arrow.was", { pct, accepted: trend.was.accepted, resolved: trend.was.resolved })}
        style={{ display: "inline-flex", color: trend.kind === "up" ? "var(--ok)" : "var(--crit)" }}
      >
        <Arrow size={12} />
      </span>
    );
  }
  if (trend.reason === "noHistory") {
    return <span data-testid="accept-arrow-none" title={t("arrow.noHistory", { period: previousPeriodLabel(window, t) })} />;
  }
  if (trend.reason === "fewDecisions") {
    return <span data-testid="accept-arrow-none" title={t("arrow.fewDecisions", { count: trend.was!.resolved })} />;
  }
  return null;
}

export function AgentRow({
  row,
  window,
  expanded,
  onToggle,
  onView,
}: {
  row: AgentPerfRow;
  window: StatsWindow;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  const t = useTranslations("agentPerformance");
  const [hover, setHover] = React.useState(false);
  const deleted = row.id === null;
  const empty = row.runs === 0;

  return (
    <div data-testid="agent-row" data-agent={row.name} style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 12,
          padding: "12px 18px",
          alignItems: "center",
          cursor: "pointer",
          background: hover ? "var(--bg-surface)" : "transparent",
          opacity: row.enabled || deleted ? 1 : 0.7,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <AgentIcon id={row.id} />
          <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {deleted ? t("table.deleted") : row.name}
          </span>
          {!row.enabled && !deleted && <Badge>{t("table.disabled")}</Badge>}
        </div>

        <span className="tnum" style={{ fontSize: 13 }}>{row.runs}</span>
        <span className="mono tnum" style={{ fontSize: 12.5 }}>{empty ? "—" : formatUsd(row.avgCostUsd)}</span>
        <span className="tnum" style={{ fontSize: 12.5 }}>{empty ? "—" : formatSeconds(row.avgDurationMs)}</span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {empty ? (
            <span style={{ color: "var(--text-muted)" }}>—</span>
          ) : (
            <>
              <AcceptRateValue accepted={row.accept.accepted} resolved={row.accept.resolved} />
              <AcceptArrow row={row} window={window} />
            </>
          )}
        </div>

        <span
          title={row.lastRunAt ? formatTimestamp(row.lastRunAt, window.tz) : undefined}
          style={{ fontSize: 11.5, color: "var(--text-muted)" }}
        >
          {formatRelative(row.lastRunAt)}
        </span>

        {deleted ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // View navigates; it must not also toggle the row
              onView();
            }}
            style={{
              justifySelf: "start",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--accent-text)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
            }}
          >
            {t("table.view")}
          </button>
        )}
      </div>

      {expanded && (
        <div
          data-testid="agent-row-expand"
          style={{ padding: "0 18px 14px 56px", display: "flex", alignItems: "center", gap: 20 }}
        >
          {row.recentRuns.length === 0 ? (
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t("expand.noRuns")}</span>
          ) : (
            <>
              <Sparkline
                data={[...row.recentRuns].reverse().map((r) => (r.durationMs ?? 0) / 1000)}
                w={160}
                h={34}
              />
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                {t("expand.lastRuns", { count: row.recentRuns.length })} ·{" "}
                <span className="mono">
                  {t("expand.summary", { duration: formatSeconds(row.avgDurationMs), cost: formatUsd(row.avgCostUsd) })}
                </span>{" "}
                <CostSourceBadge source={row.costSource} />
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
