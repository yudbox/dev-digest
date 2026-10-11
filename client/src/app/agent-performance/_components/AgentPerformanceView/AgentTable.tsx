"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AgentPerfRow, StatsWindow } from "@devdigest/shared";
import { AgentRow } from "./AgentRow";
import { GRID } from "./constants";
import { DEFAULT_SORT, sortAgentRows, type SortColumn, type SortDir } from "./helpers";

const COLUMNS: { key: SortColumn | null; label: string }[] = [
  { key: null, label: "agent" },
  { key: "runs", label: "runs" },
  { key: "avgCost", label: "avgCost" },
  { key: "avgDuration", label: "avgDuration" },
  { key: "accept", label: "accept" },
  { key: "lastRun", label: "lastRun" },
  { key: null, label: "" },
];

/**
 * The agent table. Sorting and expanding are pure client state — no request, no
 * review, no model call: the data (including each agent's recent runs) arrived
 * with the page.
 */
export function AgentTable({ rows, window }: { rows: AgentPerfRow[]; window: StatsWindow }) {
  const t = useTranslations("agentPerformance.table");
  const router = useRouter();
  const [sort, setSort] = React.useState<{ column: SortColumn; dir: SortDir }>(DEFAULT_SORT);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => sortAgentRows(rows, sort.column, sort.dir), [rows, sort]);

  const toggleSort = (column: SortColumn) =>
    setSort((s) => (s.column === column ? { column, dir: s.dir === "desc" ? "asc" : "desc" } : { column, dir: "desc" }));

  return (
    <div
      data-testid="agent-table"
      style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg-elevated)", marginBottom: 24 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 12,
          padding: "10px 18px",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border)",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {COLUMNS.map((c, i) => {
          const sortable = c.key !== null;
          const active = sortable && sort.column === c.key;
          return (
            <div key={i}>
              {c.label === "" ? null : sortable ? (
                <button
                  type="button"
                  data-testid={`sort-${c.key}`}
                  aria-label={t("sortBy", { column: t(c.label) })}
                  onClick={() => toggleSort(c.key!)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    font: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                    color: active ? "var(--text-primary)" : "inherit",
                  }}
                >
                  {t(c.label)}
                  {active ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                </button>
              ) : (
                t(c.label)
              )}
            </div>
          );
        })}
      </div>

      {sorted.map((row) => {
        const key = row.id ?? "deleted";
        return (
          <AgentRow
            key={key}
            row={row}
            window={window}
            expanded={expanded === key}
            onToggle={() => setExpanded((cur) => (cur === key ? null : key))}
            onView={() => router.push(`/agents/${row.id}?tab=stats`)}
          />
        );
      })}
    </div>
  );
}
