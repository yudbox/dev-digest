/* AgentColumnCard — compact live card per agent in Columns view (AC-21/24/27). */
"use client";

import React from "react";
import type { AgentColumn } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { agentIcon } from "../../agentIconMap";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--critical, #f87171)",
  WARNING: "var(--warning, #fb923c)",
  SUGGESTION: "var(--suggestion, #60a5fa)",
};

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
  /** Click a finding row → switch to Tabs mode. */
  onFindingClick?: (agentId: string, runId: string) => void;
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
    ? estimateProgress(elapsedMs, column.duration_ms)
    : column.status === "done"
      ? 100
      : 0;

  const AgentIcon = Icon[agentIcon(column.agent_name)] ?? Icon.Bot;

  const borderColor = failed
    ? "var(--critical, #f87171)"
    : column.verdict === "request_changes"
      ? "var(--critical, #f87171)"
      : column.verdict === "approve"
        ? "var(--ok, #4ade80)"
        : "var(--border)";

  return (
    <div
      style={{
        minWidth: 280,
        maxWidth: 320,
        flexShrink: 0,
        border: `1px solid ${running ? "var(--accent, #4f9cf9)" : borderColor}`,
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
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <AgentIcon size={14} style={{ color: "var(--text-muted)" }} />
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
              background: `conic-gradient(var(--accent, #4f9cf9) ${progress * 3.6}deg, var(--surface) 0deg)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 9,
              color: "var(--text-muted)",
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "var(--surface-raised)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
              }}
            >
              {Math.round(progress)}%
            </div>
          </div>
        ) : column.score != null ? (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: `conic-gradient(var(--ok, #4ade80) ${column.score * 3.6}deg, var(--surface) 0deg)`,
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
                background: "var(--surface-raised)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {column.score}
            </div>
          </div>
        ) : null}
      </div>

      {/* Findings list — vertically scrollable (AC-65: 5+ findings) */}
      <div
        style={{
          maxHeight: running ? 100 : 240,
          overflowY: "auto",
          scrollbarWidth: "thin",
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
              onClick={() => onFindingClick?.(column.agent_id, column.run_id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                cursor: onFindingClick ? "pointer" : "default",
                borderBottom: "1px solid var(--border-subtle, transparent)",
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background:
                    SEV_COLOR[finding.severity] ?? "var(--text-muted)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text)",
                }}
              >
                {finding.title}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                  flexShrink: 0,
                }}
              >
                {finding.file.split("/").pop()}:{finding.start_line}
              </span>
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
