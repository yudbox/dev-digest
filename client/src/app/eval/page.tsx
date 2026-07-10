/* /eval — Eval Dashboard landing page. Every workspace agent (incl. 0-case /
   0-run) plus a flat cross-agent recent-batches feed (AC-13/14/15). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button, EmptyState, Skeleton, ErrorState } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import {
  useEvalDashboardOverview,
  useRunAllEvalsForWorkspace,
} from "@/lib/hooks/evals";
import {
  EvalDashboardTable,
  joinAgentDashboards,
} from "@/components/evals/EvalDashboardTable";

export default function EvalDashboardPage() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: agents } = useAgents();
  const {
    data: overview,
    isLoading,
    isError,
    refetch,
  } = useEvalDashboardOverview();
  const runAll = useRunAllEvalsForWorkspace();

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbAgents"), href: "/agents" },
    { label: t("page.crumbEvalDashboard") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("landing.title")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const rows =
    agents && overview ? joinAgentDashboards(agents, overview.agents) : [];

  return (
    <AppShell crumb={crumb}>
      <div
        style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>
            {t("landing.title")}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {runAll.isSuccess && (
              <span
                style={{
                  fontSize: 12,
                  color: runAll.data.length === 0 ? "var(--warn)" : "var(--ok)",
                }}
              >
                {runAll.data.length === 0
                  ? t("landing.runAllEmpty")
                  : t("landing.runAllDone", { count: runAll.data.length })}
              </span>
            )}
            {runAll.isError && (
              <span style={{ fontSize: 12, color: "var(--crit)" }}>
                {t("landing.runAllError")}
              </span>
            )}
            <Button
              kind="primary"
              icon="Play"
              loading={runAll.isPending}
              onClick={() => runAll.mutate()}
            >
              {runAll.isPending
                ? t("landing.running")
                : t("landing.runAllAgents")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        ) : (
          <EvalDashboardTable
            rows={rows}
            onRowClick={(id) => router.push(`/eval/${id}`)}
          />
        )}

        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
            {t("landing.recentRuns")}
          </h2>
          {!overview || overview.recent_runs.length === 0 ? (
            <EmptyState icon="History" title={t("landing.noRecentRuns")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {/* Header row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr 140px 48px 1fr 1fr 1fr 56px",
                  gap: 12,
                  padding: "4px 12px",
                  fontSize: 10,
                  color: "var(--text-muted)",
                  letterSpacing: "0.05em",
                }}
              >
                <span>AGENT</span>
                <span>CASE</span>
                <span>DATE</span>
                <span>VER</span>
                <span>RECALL</span>
                <span>PREC</span>
                <span>CITE</span>
                <span style={{ textAlign: "right" }}>PASS</span>
              </div>
              {overview.recent_runs.map((r) => {
                const agentName =
                  agents?.find((a) => a.id === r.agent_id)?.name ?? r.agent_id;
                const recall = Math.round(r.recall * 100);
                const prec = Math.round(r.precision * 100);
                const cite = Math.round(r.citation_accuracy * 100);
                return (
                  <div
                    key={r.batch_id}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "160px 1fr 140px 48px 1fr 1fr 1fr 56px",
                      gap: 12,
                      alignItems: "center",
                      padding: "8px 12px",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--bg-elevated)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {agentName}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: r.case_name
                          ? "var(--text-secondary)"
                          : "var(--text-muted)",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                      title={r.case_name ?? undefined}
                    >
                      {r.case_name
                        ? r.case_name.length > 30
                          ? r.case_name.slice(0, 29) + "…"
                          : r.case_name
                        : `All (${r.cases_total})`}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {new Date(r.ran_at).toLocaleString()}
                    </span>
                    {r.agent_version != null ? (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--ok)",
                          background:
                            "color-mix(in srgb, var(--ok) 12%, transparent)",
                          padding: "2px 6px",
                          borderRadius: 4,
                          textAlign: "center",
                        }}
                      >
                        v{r.agent_version}
                      </span>
                    ) : (
                      <span />
                    )}
                    {/* Progress bars */}
                    {(
                      [
                        { val: recall, color: "var(--ok)" },
                        { val: prec, color: "var(--warn)" },
                        { val: cite, color: "#f97316" },
                      ] as { val: number; color: string }[]
                    ).map(({ val, color }, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            height: 5,
                            background: "var(--bg-hover)",
                            borderRadius: 3,
                          }}
                        >
                          <div
                            style={{
                              width: `${val}%`,
                              height: "100%",
                              background: color,
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color,
                            minWidth: 30,
                            textAlign: "right",
                          }}
                        >
                          {val}%
                        </span>
                      </div>
                    ))}
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        textAlign: "right",
                        fontWeight: 600,
                      }}
                    >
                      {r.traces_passed}/{r.cases_total}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
