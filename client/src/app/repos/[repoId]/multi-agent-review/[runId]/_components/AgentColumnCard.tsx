/* AgentColumnCard — compact live card per agent in Columns view (AC-21/24/27). */
"use client";

import React from "react";
import type { AgentColumn } from "@devdigest/shared";
import { Icon, SEV } from "@devdigest/ui";
import { agentIcon, agentColor as getAgentColor } from "../../agentIconMap";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--critical, #f87171)",
  WARNING: "var(--warning, #fb923c)",
  SUGGESTION: "var(--suggestion, #60a5fa)",
};

function SevIcon({ severity }: { severity: string }) {
  const meta = SEV[severity as keyof typeof SEV];
  if (!meta) return null;
  const SIcon = Icon[meta.icon as keyof typeof Icon] as React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  return <SIcon size={13} style={{ color: meta.c, flexShrink: 0 }} />;
}

/** Client-side progress estimate per AC-63: min(95%, elapsed/avg*100) */
export function estimateProgress(
  elapsedMs: number,
  avgDurationMs: number | null | undefined,
): number {
  if (!avgDurationMs || avgDurationMs <= 0) return 0;
  return Math.min(95, (elapsedMs / avgDurationMs) * 100);
}

export function AgentColumnCard({
  column,
  startedAt,
  onFindingClick,
  onViewTrace,
}: {
  column: AgentColumn;
  /** Epoch ms when this run started (for progress calc). */
  startedAt?: number;
  /** Click a finding row → switch to Tabs mode, passing findingId for auto-scroll. */
  onFindingClick?: (agentId: string, runId: string, findingId: string) => void;
  onViewTrace?: () => void;
}) {
  const [now, setNow] = React.useState(Date.now());
  const running = column.status === "running";
  const failed = column.status === "failed";

  // Tick the clock while running
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const elapsedMs = startedAt ? now - startedAt : 0;
  const progress = running
    ? estimateProgress(elapsedMs, column.avg_duration_ms)
    : column.status === "done"
      ? 100
      : 0;

  const AgentIcon =
    (
      Icon as Record<
        string,
        React.ComponentType<{ size?: number; style?: React.CSSProperties }>
      >
    )[agentIcon(column.agent_name)] ?? Icon.Bot;

  const agentColor = getAgentColor(column.agent_id);

  // Card border: always the agent's own color
  const borderColor = agentColor;

  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        border: `1px solid ${running ? agentColor : borderColor}`,
        borderRadius: 10,
        background: "var(--surface-raised)",
        overflow: "hidden",
        animation: running ? "pulse-border 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Card header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: `${agentColor}22`,
            border: `1px solid ${agentColor}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <AgentIcon size={14} style={{ color: agentColor }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {column.agent_name}
          </div>
          <div
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}
          >
            {running
              ? `${(elapsedMs / 1000).toFixed(1)}s…`
              : column.duration_ms
                ? `${(column.duration_ms / 1000).toFixed(1)}s · $${(column.cost_usd ?? 0).toFixed(3)}`
                : failed
                  ? "failed"
                  : "done"}
          </div>
        </div>

        {/* Score circle or progress ring */}
        {running ? (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: `conic-gradient(${agentColor} ${progress * 3.6}deg, #2a2a2a 0deg)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#1a1a1a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text-muted)",
              }}
            >
              {Math.round(progress)}%
            </div>
          </div>
        ) : column.score != null || failed ? (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: `conic-gradient(${agentColor} ${(column.score ?? 0) * 3.6}deg, #2a2a2a 0deg)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#1a1a1a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {column.score ?? 0}
            </div>
          </div>
        ) : null}
      </div>

      {/* Findings list */}
      <div
        style={{
          maxHeight: running ? 100 : 240,
          overflowY: "auto",
          scrollbarWidth: "none",
          padding: running ? 0 : "4px 0",
        }}
      >
        {running && (
          <div
            style={{
              padding: "12px 14px",
              fontSize: 12,
              color: "var(--text-muted)",
              fontStyle: "italic",
            }}
          >
            Running…
          </div>
        )}
        {!running &&
          column.findings.map((finding) => (
            <div
              key={finding.id}
              onClick={() =>
                onFindingClick?.(column.agent_id, column.run_id, finding.id)
              }
              style={{
                margin: "6px 10px",
                padding: "8px 10px",
                borderRadius: 7,
                background: "var(--surface, #1a1a1a)",
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
                cursor: onFindingClick ? "pointer" : "default",
              }}
            >
              {/* Title row: severity icon + bold title */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                <SevIcon severity={finding.severity} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text)",
                    lineHeight: 1.3,
                  }}
                >
                  {finding.title}
                </span>
              </div>
              {/* File:line */}
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                  marginTop: 4,
                  paddingLeft: 20,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {finding.file}:{finding.start_line}
              </div>
            </div>
          ))}
        {!running && column.findings.length === 0 && !failed && (
          <div
            style={{
              padding: "12px 14px",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            No findings
          </div>
        )}
        {failed && (
          <div
            style={{
              padding: "12px 14px",
              fontSize: 12,
              color: "var(--critical, #f87171)",
            }}
          >
            Agent run failed
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {onViewTrace ? (
          <button
            type="button"
            onClick={onViewTrace}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--accent-text, #4f9cf9)",
              padding: 0,
            }}
          >
            View trace
          </button>
        ) : (
          <span />
        )}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {column.findings.length} finding
          {column.findings.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
