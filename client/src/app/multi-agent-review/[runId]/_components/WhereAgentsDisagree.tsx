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
  onSelectAgent?: (agentId: string, runId: string) => void;
}) {
  if (conflicts.length === 0) return null;

  const displayedConflicts = showOnlyConflicts
    ? conflicts.filter((c) => {
        const flaggers = c.takes.filter((t) => t.verdict !== "ignored");
        return flaggers.length >= 2;
      })
    : conflicts;

  if (displayedConflicts.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      {/* Header */}
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

      {/* Contention rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {displayedConflicts.map((conflict, idx) => (
          <div
            key={idx}
            style={{
              padding: "12px 16px",
              borderRadius: 9,
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
            }}
          >
            {/* Location header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              <Icon.Code size={13} />
              <span
                style={{
                  fontFamily: "monospace",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                {conflict.file}:{conflict.line}
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {conflict.title}
              </span>
            </div>

            {/* Per-agent mini tiles */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
                gap: 8,
              }}
            >
              {columns.map((col) => {
                const take = conflict.takes.find(
                  (t) => t.agent_id === col.agent_id,
                );
                const flagged = take && take.verdict !== "ignored";

                return (
                  <div
                    key={col.agent_id}
                    onClick={() =>
                      flagged && onSelectAgent
                        ? onSelectAgent(col.agent_id, col.run_id)
                        : undefined
                    }
                    style={{
                      padding: "8px 10px",
                      borderRadius: 7,
                      border: flagged
                        ? `1px solid ${SEV_COLOR[take!.verdict as string] ?? "var(--border)"}`
                        : "1px solid var(--border)",
                      background: flagged
                        ? `color-mix(in srgb, ${SEV_COLOR[take!.verdict as string] ?? "transparent"} 8%, transparent)`
                        : "var(--surface)",
                      cursor: flagged ? "pointer" : "default",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        marginBottom: 3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col.agent_name}
                    </div>
                    {flagged ? (
                      <>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            marginBottom: 2,
                          }}
                        >
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background:
                                SEV_COLOR[take!.verdict as string] ??
                                "var(--text-muted)",
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color:
                                SEV_COLOR[take!.verdict as string] ??
                                "var(--text)",
                              textTransform: "uppercase",
                            }}
                          >
                            {take!.verdict}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            lineHeight: 1.3,
                          }}
                        >
                          {take!.note}
                        </div>
                      </>
                    ) : (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        • did not flag
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
