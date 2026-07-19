/* /repos/[repoId]/multi-agent-review — list of multi_agent_runs for the repo (AC-42/50). */
"use client";

import React from "react";
import { useRouter, useParams } from "next/navigation";
import { useMultiAgentRuns } from "../../../../lib/hooks/reviews";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";

function statusColor(s: MultiAgentRunSummary["status"]) {
  if (s === "running") return "var(--accent-text, #4f9cf9)";
  if (s === "failed") return "var(--critical, #f87171)";
  return "var(--ok, #4ade80)";
}

export default function MultiAgentReviewListPage() {
  const router = useRouter();
  const { repoId } = useParams<{ repoId: string }>();
  const base = `/repos/${repoId}/multi-agent-review`;
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<
    "running" | "failed" | "done" | undefined
  >();
  const [cursor, setCursor] = React.useState<string | undefined>();

  const { data, isLoading } = useMultiAgentRuns({
    limit: 20,
    cursor,
    q: q || undefined,
    status,
  });

  return (
    <AppShell crumb={[{ label: "Multi-Agent Review" }]}>
      <div style={{ padding: "24px 32px", maxWidth: 900 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            Multi-Agent Review
          </h1>
          <button
            type="button"
            onClick={() => router.push(`${base}/new`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              background: "var(--accent, #4f9cf9)",
              color: "#fff",
            }}
          >
            <Icon.Users size={14} />
            Run a review
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input
            placeholder="Search PR title or number…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(undefined);
            }}
            style={{
              flex: 1,
              padding: "7px 12px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
              color: "var(--text)",
              fontSize: 13,
            }}
          />
          <select
            value={status ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setStatus(v ? (v as typeof status) : undefined);
              setCursor(undefined);
            }}
            style={{
              padding: "7px 10px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
              color: "var(--text)",
              fontSize: 13,
            }}
          >
            <option value="">All statuses</option>
            <option value="running">Running</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Loading…
          </div>
        ) : !data?.items.length ? (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              textAlign: "center",
              padding: 40,
            }}
          >
            No multi-agent runs yet.{" "}
            <a
              href={`${base}/new`}
              style={{ color: "var(--accent-text)" }}
            >
              Start one →
            </a>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.items.map((run) => (
                <div
                  key={run.id}
                  onClick={() => router.push(`${base}/${run.id}`)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderRadius: 9,
                    border: "1px solid var(--border)",
                    background: "var(--surface-raised)",
                    cursor: "pointer",
                    gap: 14,
                    transition: "border-color 0.12s",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: statusColor(run.status),
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--text)",
                      }}
                    >
                      #{run.pr_number} · {run.pr_title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {run.agent_count} agent{run.agent_count !== 1 ? "s" : ""}
                      {run.total_duration_ms
                        ? ` · ${(run.total_duration_ms / 1000).toFixed(1)}s`
                        : ""}
                      {run.total_cost_usd
                        ? ` · $${run.total_cost_usd.toFixed(3)}`
                        : ""}
                      {" · "}
                      {new Date(run.ran_at).toLocaleString()}
                    </div>
                  </div>
                  <Icon.ChevronRight
                    size={16}
                    style={{ color: "var(--text-muted)", flexShrink: 0 }}
                  />
                </div>
              ))}
            </div>

            {/* Pagination */}
            {data.next_cursor && (
              <button
                type="button"
                onClick={() => setCursor(data.next_cursor!)}
                style={{
                  marginTop: 16,
                  padding: "8px 20px",
                  borderRadius: 7,
                  fontSize: 13,
                  cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: "var(--surface-raised)",
                  color: "var(--text)",
                }}
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
