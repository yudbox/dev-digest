/* /eval/[agentId] — agent eval detail dashboard: 3 MetricCards w/ deltas
   (only shown with >=2 batches — AC-18), trend LineChart, run-history table
   with Compare (AC-17/20/21). */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  ErrorState,
  Skeleton,
  MetricCard,
  LineChart,
  Badge,
  Dropdown,
} from "@devdigest/ui";
import { useAgent, useAgents } from "@/lib/hooks/agents";
import { useEvalDashboard, useRunAgentEvals } from "@/lib/hooks/evals";
import { RunsTable, groupRunsByBatch } from "@/components/evals/RunsTable";
import { CompareRunsModal } from "@/components/evals/CompareRunsModal";

export default function EvalAgentDetailPage() {
  const t = useTranslations("eval");
  const params = useParams<{ agentId: string }>();
  const { agentId } = params;

  const {
    data: agent,
    isLoading: agentLoading,
    isError,
    refetch,
  } = useAgent(agentId);
  const { data: dashboard, isLoading: dashboardLoading } = useEvalDashboard(
    "agent",
    agentId,
  );
  const runEvals = useRunAgentEvals(agentId);
  const { data: agents } = useAgents();
  const router = useRouter();

  const [selected, setSelected] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: agent?.name ?? t("page.crumbEvals") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.loadError")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const trend = dashboard?.trend ?? [];
  // Deltas only render once >=2 batches exist (AC-18) — the "TRACES PASSED"
  // concept lives in RunsTable's plain "X/Y" pass column (no MetricCard, so
  // it never has a delta at all, satisfying AC-18's other half).
  const showDeltas = trend.length >= 2;

  const batches = dashboard ? groupRunsByBatch(dashboard.recent_runs) : [];
  const selectedBatches = batches.filter((b) => selected.includes(b.batch_id));

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
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {agentLoading ? (
                <Skeleton width={200} height={24} />
              ) : (
                <>
                  <h1 style={{ fontSize: 20, fontWeight: 700 }}>
                    {agent?.name}
                  </h1>
                  {agent?.model && (
                    <Badge mono color="var(--text-muted)" bg="var(--bg-hover)">
                      {agent.model}
                    </Badge>
                  )}
                </>
              )}
            </div>
            {agent?.description && (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  marginTop: 4,
                }}
              >
                {agent.description}
              </p>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <Dropdown
              align="right"
              trigger={
                <Button kind="secondary" size="sm" iconRight="ChevronDown">
                  {agent?.name ?? "Agent"}
                </Button>
              }
              items={(agents ?? []).map((a) => ({
                label: a.name,
                onClick: () => router.push(`/eval/${a.id}`),
              }))}
            />
            <Button kind="secondary" size="sm" icon="Calendar">
              30 days
            </Button>
            <Button
              kind="primary"
              icon="Play"
              loading={runEvals.isPending}
              onClick={() => runEvals.mutate()}
            >
              {runEvals.isPending
                ? t("detail.running")
                : t("detail.runAllEvals")}
            </Button>
          </div>
        </div>

        {dashboardLoading || !dashboard ? (
          <Skeleton height={200} />
        ) : (
          <>
            <div style={{ display: "flex", gap: 12 }}>
              <MetricCard
                label={t("dashboard.metrics.recall")}
                value={`${Math.round(dashboard.current.recall * 100)}`}
                suffix="%"
                delta={showDeltas ? dashboard.delta.recall : undefined}
                trend={trend.map((p) => p.recall)}
                color="var(--accent)"
              />
              <MetricCard
                label={t("dashboard.metrics.precision")}
                value={`${Math.round(dashboard.current.precision * 100)}`}
                suffix="%"
                delta={showDeltas ? dashboard.delta.precision : undefined}
                trend={trend.map((p) => p.precision)}
                color="var(--ok)"
              />
              <MetricCard
                label={t("dashboard.metrics.citationAccuracy")}
                value={`${Math.round(dashboard.current.citation_accuracy * 100)}`}
                suffix="%"
                delta={
                  showDeltas ? dashboard.delta.citation_accuracy : undefined
                }
                trend={trend.map((p) => p.citation_accuracy)}
                color="var(--warn)"
              />
            </div>

            {dashboard.alert && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--warn)",
                  background: "var(--warn-bg)",
                  color: "var(--warn)",
                  fontSize: 13,
                }}
              >
                {dashboard.alert}
              </div>
            )}

            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                {t("detail.metricTrend")}
              </h2>
              <LineChart
                series={[
                  {
                    name: t("dashboard.legend.recall"),
                    color: "var(--accent)",
                    data: trend.map((p) => p.recall),
                  },
                  {
                    name: t("dashboard.legend.precision"),
                    color: "var(--ok)",
                    data: trend.map((p) => p.precision),
                  },
                  {
                    name: t("dashboard.legend.citation"),
                    color: "var(--warn)",
                    data: trend.map((p) => p.citation_accuracy),
                  },
                ]}
              />
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ fontSize: 15, fontWeight: 700 }}>
                  {t("detail.runHistory")}
                </h2>
                <Button
                  kind="secondary"
                  size="sm"
                  disabled={selected.length !== 2}
                  onClick={() => setCompareOpen(true)}
                >
                  {t("detail.compareSelected")}
                </Button>
              </div>
              <RunsTable
                runs={dashboard.recent_runs}
                selected={selected}
                onSelectionChange={setSelected}
              />
            </div>
          </>
        )}
      </div>

      {compareOpen && selectedBatches.length === 2 && agent && (
        <CompareRunsModal
          agent={agent}
          batchA={selectedBatches[0]!}
          batchB={selectedBatches[1]!}
          onClose={() => {
            setCompareOpen(false);
            setSelected([]);
          }}
        />
      )}
    </AppShell>
  );
}
