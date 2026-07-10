/* RunsTable — agent eval-dashboard batch run history. Checkboxes capped at
   2 selections (feeds CompareRunsModal), "X/Y" pass column, cost column. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Badge, ProgressBar } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { groupRunsByBatch } from "./helpers";

export function RunsTable({
  runs,
  selected,
  onSelectionChange,
}: {
  runs: EvalRunRecord[];
  selected: string[];
  onSelectionChange: (batchIds: string[]) => void;
}) {
  const t = useTranslations("eval.dashboard.table");
  const batches = groupRunsByBatch(runs);

  function toggle(batchId: string) {
    if (selected.includes(batchId)) {
      onSelectionChange(selected.filter((id) => id !== batchId));
    } else if (selected.length < 2) {
      onSelectionChange([...selected, batchId]);
    }
    // Already at 2 selections and this row isn't selected — ignore the click
    // (caller must deselect one first).
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <th style={{ width: 32 }} />
          <th
            style={{
              textAlign: "left",
              padding: "8px 6px",
              color: "var(--text-muted)",
            }}
          >
            {t("ranAt")}
          </th>
          <th
            style={{
              textAlign: "left",
              padding: "8px 6px",
              color: "var(--text-muted)",
            }}
          >
            {t("version")}
          </th>
          <th
            style={{
              textAlign: "right",
              padding: "8px 6px",
              color: "var(--text-muted)",
            }}
          >
            {t("recall")}
          </th>
          <th
            style={{
              textAlign: "right",
              padding: "8px 6px",
              color: "var(--text-muted)",
            }}
          >
            {t("precision")}
          </th>
          <th
            style={{
              textAlign: "right",
              padding: "8px 6px",
              color: "var(--text-muted)",
            }}
          >
            {t("citation")}
          </th>
          <th
            style={{
              textAlign: "right",
              padding: "8px 6px",
              color: "var(--text-muted)",
            }}
          >
            {t("pass")}
          </th>
          <th
            style={{
              textAlign: "right",
              padding: "8px 6px",
              color: "var(--text-muted)",
            }}
          >
            {t("cost")}
          </th>
        </tr>
      </thead>
      <tbody>
        {batches.map((b) => (
          <tr
            key={b.batch_id}
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <td style={{ padding: "8px 6px" }}>
              <Checkbox
                checked={selected.includes(b.batch_id)}
                onChange={() => toggle(b.batch_id)}
              />
            </td>
            <td style={{ padding: "8px 6px" }}>
              {new Date(b.ran_at).toLocaleString()}
            </td>
            <td style={{ padding: "8px 6px" }}>
              {b.agent_version != null ? (
                <Badge
                  mono
                  color="var(--accent)"
                  bg="transparent"
                  style={{ padding: "1px 0" }}
                >
                  v{b.agent_version}
                </Badge>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>—</span>
              )}
            </td>
            <td style={{ padding: "8px 6px", minWidth: 100 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ProgressBar
                  value={Math.round(b.recall * 100)}
                  color="var(--accent)"
                  height={4}
                />
                <span className="tnum" style={{ fontSize: 12, minWidth: 32 }}>
                  {Math.round(b.recall * 100)}%
                </span>
              </div>
            </td>
            <td style={{ padding: "8px 6px", minWidth: 100 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ProgressBar
                  value={Math.round(b.precision * 100)}
                  color="var(--ok)"
                  height={4}
                />
                <span className="tnum" style={{ fontSize: 12, minWidth: 32 }}>
                  {Math.round(b.precision * 100)}%
                </span>
              </div>
            </td>
            <td style={{ padding: "8px 6px", minWidth: 100 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ProgressBar
                  value={Math.round(b.citation_accuracy * 100)}
                  color="var(--warn)"
                  height={4}
                />
                <span className="tnum" style={{ fontSize: 12, minWidth: 32 }}>
                  {Math.round(b.citation_accuracy * 100)}%
                </span>
              </div>
            </td>
            <td
              className="tnum"
              style={{ textAlign: "right", padding: "8px 6px" }}
            >
              {b.traces_passed}/{b.cases_total}
            </td>
            <td
              className="tnum"
              style={{ textAlign: "right", padding: "8px 6px" }}
            >
              {b.cost_usd != null ? `$${b.cost_usd.toFixed(3)}` : "–"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
