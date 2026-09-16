/* /repos/[repoId]/multi-agent-review/[runId] — detail page (AC-16-24, AC-27-37, AC-63-65). */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useMultiAgentRun,
  useRunEvents,
} from "../../../../../lib/hooks/reviews";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentColumn } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { AgentColumnCard } from "./_components/AgentColumnCard";
import { WhereAgentsDisagree } from "./_components/WhereAgentsDisagree";
import RunTraceDrawer from "../../pulls/[number]/_components/RunTraceDrawer";
import { VerdictBanner } from "../../pulls/[number]/_components/VerdictBanner";
import { FindingsPanel } from "../../pulls/[number]/_components/FindingsPanel";
import { AppShell } from "../../../../../components/app-shell";

type ViewMode = "columns" | "tabs";

export default function MultiAgentRunDetailPage() {
  const params = useParams<{ repoId: string; runId: string }>();
  const router = useRouter();
  const { repoId, runId } = params;
  const base = `/repos/${repoId}/multi-agent-review`;

  const { data: run, isLoading } = useMultiAgentRun(runId);
  const qc = useQueryClient();

  // AC-19: subscribe via SSE to each agent_run that is still running.
  // Only invalidate the multi-agent-run query on completion events (result/error)
  // to avoid a refetch on every log message.
  const runningRunIds =
    run?.columns.filter((c) => c.status === "running").map((c) => c.run_id) ??
    [];
  const { events } = useRunEvents(runningRunIds);
  const prevEventsLen = React.useRef(0);
  React.useEffect(() => {
    const newEvents = events.slice(prevEventsLen.current);
    prevEventsLen.current = events.length;
    const hasCompletion = newEvents.some(
      (e) => e.kind === "result" || e.kind === "error",
    );
    if (hasCompletion) {
      void qc.invalidateQueries({ queryKey: ["multi-agent-run", runId] });
    }
  }, [events.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // head_sha and repo_full_name for file:line GitHub links (AC-34) — from run directly
  const headSha = run?.head_sha ?? null;
  const repoFullName = run?.repo_full_name ?? null;

  const [view, setView] = React.useState<ViewMode>("columns");
  const [selectedTab, setSelectedTab] = React.useState<string | null>(null);
  const [showOnlyConflicts, setShowOnlyConflicts] = React.useState(false);
  const [targetFindingId, setTargetFindingId] = React.useState<string | null>(
    null,
  );
  const [traceDrawer, setTraceDrawer] = React.useState<{
    runId: string;
    agentName: string;
    findings: AgentColumn["findings"];
  } | null>(null);

  const startedAt = React.useRef<number>(Date.now()).current;

  const SEV_RANK: Record<string, number> = {
    CRITICAL: 3,
    WARNING: 2,
    SUGGESTION: 1,
  };

  // Tabs mode: show the selected agent tab or first by default
  const activeTabAgent: AgentColumn | undefined =
    view === "tabs" && run
      ? (run.columns.find((c) => c.agent_id === selectedTab) ?? run.columns[0])
      : undefined;

  // AC-20: sort findings by severity descending so most severe is first (defaultExpanded)
  const tabFindings = React.useMemo(() => {
    if (!activeTabAgent) return [];
    return [...activeTabAgent.findings].sort(
      (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0),
    );
  }, [activeTabAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div
        style={{
          padding: "40px 32px",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!run) {
    return (
      <div style={{ padding: "40px 32px" }}>
        <div style={{ color: "var(--critical, #f87171)", fontSize: 14 }}>
          Run not found.
        </div>
      </div>
    );
  }

  const anyRunning = run.columns.some((c) => c.status === "running");
  const durationLabel = run.total_duration_ms
    ? `${(run.total_duration_ms / 1000).toFixed(1)}s total`
    : null;
  const costLabel = run.total_cost_usd
    ? `$${run.total_cost_usd.toFixed(3)}`
    : null;

  const handleFindingClick = (
    agentId: string,
    _runId: string,
    findingId: string,
  ) => {
    setView("tabs");
    setSelectedTab(agentId);
    setTargetFindingId(findingId);
    router.push(`?finding=${findingId}`);
  };

  return (
    <AppShell
      crumb={[
        { label: "Multi-Agent Review", href: base },
        { label: run ? `#${run.pr_number}` : "…" },
      ]}
    >
      <div style={{ padding: "20px 28px" }}>
        {/* Row 1: Configure run + title + agents count | Columns/Tabs toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => router.push(`${base}/new?prId=${run.pr_id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                border: "1px solid var(--border)",
                background: "var(--surface-raised)",
                color: "var(--text-muted)",
              }}
            >
              <Icon.Settings size={12} />
              Configure run
            </button>
            <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>
              Multi-Agent Review
            </h1>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {run.columns.length} selected agents · parallel
            </span>
          </div>

          {/* View mode toggle — active = blue */}
          <div
            style={{
              display: "flex",
              border: "1px solid var(--border)",
              borderRadius: 7,
              overflow: "hidden",
            }}
          >
            {(["columns", "tabs"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: view === m ? 600 : 400,
                  cursor: "pointer",
                  border: "none",
                  borderRight: m === "columns" ? "1px solid var(--border)" : "none",
                  background: view === m ? "var(--accent, #4f9cf9)" : "transparent",
                  color: view === m ? "#fff" : "var(--text-muted)",
                  transition: "background 0.12s, color 0.12s",
                }}
              >
                {m === "columns" ? "Columns" : "Tabs"}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: PR number + title (left) | stats (right) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
              #{run.pr_number}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              {run.pr_title}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            <Icon.Users size={13} />
            <span>{run.columns.length} agents</span>
            {durationLabel && <><span>·</span><span>{durationLabel}</span></>}
            {costLabel && <><span>·</span><span>{costLabel}</span></>}
            {anyRunning && (
              <span style={{ color: "var(--accent-text)" }}>· running…</span>
            )}
          </div>
        </div>

        {/* ---- COLUMNS VIEW ---- */}
        {view === "columns" && (
          <div
            style={{
              display: "flex",
              gap: 14,
              overflowX: "auto",
              padding: "14px 0 4px",
              scrollbarWidth: "thin",
            }}
          >
            {run.columns.map((col) => (
              <AgentColumnCard
                key={col.agent_id}
                column={col}
                startedAt={startedAt}
                onFindingClick={handleFindingClick}
                onViewTrace={() =>
                  setTraceDrawer({
                    runId: col.run_id,
                    agentName: col.agent_name,
                    findings: col.findings,
                  })
                }
              />
            ))}
          </div>
        )}

        {/* ---- TABS VIEW ---- */}
        {view === "tabs" && (
          <div>
            {/* Tab bar */}
            <div
              style={{
                display: "flex",
                gap: 4,
                borderBottom: "1px solid var(--border)",
                marginBottom: 16,
                overflowX: "auto",
              }}
            >
              {run.columns.map((col) => {
                const isActive =
                  (selectedTab ?? run.columns[0]?.agent_id) === col.agent_id;
                const worstSev =
                  col.findings.length > 0
                    ? col.findings.reduce((worst, f) => {
                        const rank: Record<string, number> = {
                          CRITICAL: 3,
                          WARNING: 2,
                          SUGGESTION: 1,
                        };
                        return (rank[f.severity] ?? 0) > (rank[worst] ?? 0)
                          ? f.severity
                          : worst;
                      }, "SUGGESTION")
                    : null;

                return (
                  <button
                    key={col.agent_id}
                    type="button"
                    onClick={() => setSelectedTab(col.agent_id)}
                    style={{
                      padding: "8px 16px",
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      cursor: "pointer",
                      border: "none",
                      background: "none",
                      borderBottom: isActive
                        ? "2px solid var(--accent, #4f9cf9)"
                        : "2px solid transparent",
                      color: isActive ? "var(--text)" : "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      whiteSpace: "nowrap",
                      transition: "color 0.1s",
                    }}
                  >
                    {col.agent_name}
                    {col.score != null && (
                      <span
                        style={{
                          padding: "1px 7px",
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 700,
                          background: "var(--surface)",
                          color: "var(--text-muted)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {col.score}
                      </span>
                    )}
                    {worstSev && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background:
                            worstSev === "CRITICAL"
                              ? "var(--critical, #f87171)"
                              : worstSev === "WARNING"
                                ? "var(--warning, #fb923c)"
                                : "var(--suggestion, #60a5fa)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Active tab body */}
            {activeTabAgent && (
              <div>
                {activeTabAgent.verdict && (
                  <VerdictBanner
                    verdict={
                      activeTabAgent.verdict as
                        | "request_changes"
                        | "approve"
                        | "comment"
                    }
                    summary={activeTabAgent.summary}
                    score={activeTabAgent.score}
                    findingsCount={activeTabAgent.findings.length}
                    blockers={
                      activeTabAgent.findings.filter(
                        (f) => f.severity === "CRITICAL",
                      ).length
                    }
                    agentName={activeTabAgent.agent_name}
                    durationMs={activeTabAgent.duration_ms}
                    costUsd={activeTabAgent.cost_usd}
                    onViewTrace={() =>
                      setTraceDrawer({
                        runId: activeTabAgent.run_id,
                        agentName: activeTabAgent.agent_name,
                        findings: activeTabAgent.findings,
                      })
                    }
                  />
                )}
                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {activeTabAgent.findings.length === 0 ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-muted)",
                        padding: "12px 0",
                      }}
                    >
                      No findings
                    </div>
                  ) : (
                    <FindingsPanel
                      findings={tabFindings}
                      prId={run.pr_id}
                      repoFullName={repoFullName}
                      headSha={headSha}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* WHERE AGENTS DISAGREE */}
        <WhereAgentsDisagree
          conflicts={run.conflicts}
          columns={run.columns}
          showOnlyConflicts={showOnlyConflicts}
          onToggleShowOnlyConflicts={() => setShowOnlyConflicts((s) => !s)}
          onSelectAgent={(agentId, _runId, findingId) => {
            setView("tabs");
            setSelectedTab(agentId);
            if (findingId) {
              router.push(`?finding=${findingId}`);
            }
          }}
        />

        {/* Run trace drawer */}
        {traceDrawer && (
          <RunTraceDrawer
            runId={traceDrawer.runId}
            agentName={traceDrawer.agentName}
            prNumber={run.pr_number ?? undefined}
            findings={traceDrawer.findings}
            onClose={() => setTraceDrawer(null)}
          />
        )}
      </div>
    </AppShell>
  );
}
