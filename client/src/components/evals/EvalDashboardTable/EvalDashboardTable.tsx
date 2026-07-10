/* EvalDashboardTable — `/eval` landing table: one row per workspace agent,
   including agents with 0 cases / 0 runs (AC-13). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Sparkline } from "@devdigest/ui";
import { hasNoCases, neverRun, type EvalDashboardRow } from "./helpers";

/** Colored metric column — label + big %-number, matching the design. */
function MetricCol({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={{ textAlign: "center", minWidth: 48 }}>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.05em",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>
        {Math.round(value * 100)}%
      </div>
    </div>
  );
}

export function EvalDashboardTable({
  rows,
  onRowClick,
}: {
  rows: EvalDashboardRow[];
  onRowClick: (agentId: string) => void;
}) {
  const t = useTranslations("eval.dashboard");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map(({ agent, dashboard }) => {
        const noCases = hasNoCases(dashboard);
        const notRun = neverRun(dashboard);
        const lastRun = dashboard.recent_runs[0];

        return (
          <div
            key={agent.id}
            role="button"
            tabIndex={0}
            onClick={() => onRowClick(agent.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onRowClick(agent.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              cursor: "pointer",
            }}
          >
            {/* Agent icon */}
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Settings size={14} />
            </div>

            {/* Name + model + last-run info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {agent.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "var(--accent-bg)",
                    padding: "1px 7px",
                    borderRadius: 4,
                    fontFamily: "monospace",
                  }}
                >
                  {agent.model}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {noCases ? (
                  <>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {t("configure")}
                    </span>{" "}
                    →
                  </>
                ) : notRun ? (
                  t("noRuns")
                ) : lastRun ? (
                  `Last run${lastRun.agent_version != null ? ` v${lastRun.agent_version}` : ""} · ${new Date(lastRun.ran_at).toLocaleString()} · ${dashboard.current.traces_passed}/${dashboard.current.traces_total} pass`
                ) : null}
              </div>
            </div>

            {/* Sparkline */}
            {!noCases && (
              <Sparkline
                data={notRun ? [0, 0] : dashboard.trend.map((p) => p.recall)}
                color={notRun ? "var(--text-muted)" : "var(--accent)"}
              />
            )}

            {/* Metrics */}
            {!noCases && !notRun && (
              <>
                <MetricCol
                  label="RECALL"
                  value={dashboard.current.recall}
                  color="var(--ok)"
                />
                <MetricCol
                  label="PREC"
                  value={dashboard.current.precision}
                  color="var(--warn)"
                />
                <MetricCol
                  label="CITE"
                  value={dashboard.current.citation_accuracy}
                  color="#f97316"
                />
              </>
            )}

            <Icon.ChevronRight
              size={14}
              style={{ color: "var(--text-muted)", flexShrink: 0 }}
            />
          </div>
        );
      })}
    </div>
  );
}
