/* WhereAgentsDisagree — shows contention groups where agents diverge (AC-27-36). */
"use client";

import React from "react";
import type { Conflict, AgentColumn } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--critical, #f87171)",
  WARNING: "var(--warning, #fb923c)",
  SUGGESTION: "var(--suggestion, #60a5fa)",
};

export function WhereAgentsDisagree({
  conflicts,
  columns,
  showOnlyConflicts,
  onToggleShowOnlyConflicts,
  onSelectAgent,
}: {
  conflicts: Conflict[];
  columns: AgentColumn[];
  showOnlyConflicts: boolean;
  onToggleShowOnlyConflicts: () => void;
  /** Called when a flagging mini-tile is clicked — handoff to Tabs mode. */
  onSelectAgent?: (agentId: string, runId: string, findingId?: string) => void;
}) {
  if (conflicts.length === 0) return null;

  const displayedConflicts = showOnlyConflicts
    ? conflicts.filter((c) => {
        // AC-32: true head-to-head = 2+ agents each with a finding AND divergent severity.
        const flaggers = c.takes.filter((t) => t.verdict !== "ignored");
        const severities = new Set(flaggers.map((t) => t.verdict));
        return flaggers.length >= 2 && severities.size > 1;
      })
    : conflicts;

  return (
    <div style={{ marginTop: 32 }}>
      {/* Header — always visible */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon.TrendingUp size={15} style={{ color: "var(--text-muted)" }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Where agents disagree
          </span>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          Show only conflicts
          <div
            onClick={onToggleShowOnlyConflicts}
            style={{
              width: 32,
              height: 18,
              borderRadius: 9,
              background: showOnlyConflicts
                ? "var(--accent, #4f9cf9)"
                : "var(--border)",
              cursor: "pointer",
              transition: "background 0.15s",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 2,
                left: showOnlyConflicts ? 15 : 2,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.15s",
              }}
            />
          </div>
        </label>
      </div>

      {/* Contention rows — empty state when filter yields nothing */}
      {displayedConflicts.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
          No head-to-head conflicts found.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {displayedConflicts.map((conflict, idx) => (
          <div
            key={idx}
            style={{
              padding: "14px 16px",
              borderRadius: 9,
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
            }}
          >
            {/* Location header: monospace path + bold white title */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <Icon.Code size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span
                style={{
                  fontFamily: "monospace",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {conflict.file}:{conflict.line}
              </span>
              <span style={{ fontWeight: 700, color: "var(--text)" }}>
                {conflict.title}
              </span>
            </div>

            {/* Per-agent columns — no individual bordered boxes */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
                gap: 12,
              }}
            >
              {columns.map((col) => {
                const take = conflict.takes.find(
                  (t) => t.agent_id === col.agent_id,
                );
                const flagged = take && take.verdict !== "ignored";
                const sevColor = SEV_COLOR[take?.verdict as string] ?? "var(--text-muted)";

                // Find matching finding to check dismissed/accepted status
                const finding = col.findings.find(
                  f => f.file === conflict.file && f.start_line === conflict.line
                );
                const isDismissed = !!finding?.dismissed_at;
                const isAccepted = !!finding?.accepted_at;

                return (
                  <div
                    key={col.agent_id}
                    onClick={() => {
                      if (flagged && !isDismissed && onSelectAgent) {
                        onSelectAgent(col.agent_id, col.run_id, finding?.id);
                      }
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: flagged
                        ? `1px solid ${isDismissed ? "var(--border)" : sevColor}`
                        : "1px solid var(--border)",
                      background: flagged && !isDismissed
                        ? `color-mix(in srgb, ${sevColor} 10%, transparent)`
                        : "transparent",
                      cursor: flagged && !isDismissed ? "pointer" : "default",
                      opacity: isDismissed ? 0.4 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {/* Agent name */}
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text)",
                        marginBottom: 5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col.agent_name}
                    </div>
                    {flagged ? (
                      <>
                        {/* Badge: dot + severity label */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            marginBottom: 4,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: isDismissed ? "var(--text-muted)" : sevColor,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: isDismissed ? "var(--text-muted)" : sevColor,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              textDecoration: isDismissed ? "line-through" : "none",
                            }}
                          >
                            {take!.verdict}
                          </span>
                          {isDismissed && (
                            <span
                              style={{
                                fontSize: 10,
                                color: "var(--text-muted)",
                                background: "var(--surface-2, #2a2a2a)",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontWeight: 500,
                              }}
                            >
                              dismissed
                            </span>
                          )}
                          {isAccepted && (
                            <span
                              style={{
                                fontSize: 10,
                                color: "var(--success, #4caf50)",
                                background: "rgba(76,175,80,0.1)",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontWeight: 500,
                              }}
                            >
                              accepted
                            </span>
                          )}
                        </div>
                        {/* Note */}
                        {take!.note && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              lineHeight: 1.4,
                            }}
                          >
                            {take!.note}
                          </div>
                        )}
                      </>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "var(--text-muted)",
                            flexShrink: 0,
                            opacity: 0.4,
                          }}
                        />
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          did not flag
                        </span>
                      </div>
                    )}
                    {/* Muted note for non-flagging agent */}
                    {!flagged && take?.note && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4, opacity: 0.7 }}>
                        {take.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
