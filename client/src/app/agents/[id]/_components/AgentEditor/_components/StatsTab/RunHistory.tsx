"use client";

import React from "react";
import Link from "next/link";
import { Badge, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { AgentRunItem } from "@devdigest/shared";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { CostSourceBadge, formatTimestamp, formatTokens, formatUsd } from "@/components/stats";
import { useAgentRuns, useRunFindings } from "@/lib/hooks/performance";
import { localTz } from "@/lib/utils/period";
import { prefetchIndex, totalTokens } from "./helpers";

const GRID = "150px 60px 70px 110px 70px 60px 110px";
const cell: React.CSSProperties = { fontSize: 12 };

function TraceDrawer({ run, agentName, onClose }: { run: AgentRunItem; agentName: string; onClose: () => void }) {
  // One GET for this run's findings, made only now that the drawer is open.
  const { data } = useRunFindings(run.id, true);
  return (
    <RunTraceDrawer
      runId={run.id}
      agentName={agentName}
      prNumber={run.pr?.number ?? null}
      findings={data?.items}
      onClose={onClose}
    />
  );
}

function PrCell({ pr }: { pr: AgentRunItem["pr"] }) {
  if (!pr) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const label = `#${pr.number}`;
  const style = { color: "var(--accent-text)" } as const;
  if (pr.repoId) return <Link href={`/repos/${pr.repoId}/pulls/${pr.number}`} className="mono" style={style}>{label}</Link>;
  if (pr.githubUrl) return <a href={pr.githubUrl} target="_blank" rel="noreferrer" className="mono" style={style}>{label}</a>;
  return <span className="mono">{label}</span>;
}

function TraceCell({ run, onOpen }: { run: AgentRunItem; onOpen: () => void }) {
  const t = useTranslations("agents.stats.history");
  if (run.source === "ci") {
    return run.ciRunUrl ? (
      <a href={run.ciRunUrl} target="_blank" rel="noreferrer" style={{ ...cell, color: "var(--accent-text)" }}>
        {t("openGithub")}
      </a>
    ) : null;
  }
  return run.hasTrace ? (
    <button
      type="button"
      onClick={onOpen}
      style={{ ...cell, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent-text)" }}
    >
      {t("viewTrace")}
    </button>
  ) : null;
}

/**
 * The agent's run history for the selected period, newest first, 10 rows at a
 * time. The next page loads when the 5th row from the end scrolls into view, so
 * a long history never loads at once. Reading it never starts a run.
 */
export function RunHistory({ agentId, agentName }: { agentId: string; agentName: string }) {
  const t = useTranslations("agents.stats.history");
  const q = useAgentRuns(agentId);
  const [traceRun, setTraceRun] = React.useState<AgentRunItem | null>(null);
  const tz = React.useMemo(() => localTz(), []);

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinelAt = q.hasNextPage ? prefetchIndex(items.length) : -1;

  const observer = React.useRef<IntersectionObserver | null>(null);
  const sentinelRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      observer.current?.disconnect();
      if (!node) return;
      observer.current = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && q.hasNextPage && !q.isFetchingNextPage) {
          void q.fetchNextPage();
        }
      });
      observer.current.observe(node);
    },
    [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage],
  );
  React.useEffect(() => () => observer.current?.disconnect(), []);

  return (
    <div data-testid="run-history">
      <SectionLabel icon="History">{t("title")}</SectionLabel>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-elevated)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 10,
            padding: "9px 14px",
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
          }}
        >
          {["timestamp", "pr", "tokens", "cost", "findings", "source", ""].map((c, i) => (
            <div key={i}>{c && t(c)}</div>
          ))}
        </div>

        <div data-testid="run-history-scroll" style={{ maxHeight: 380, overflowY: "auto" }}>
          {q.isPending ? (
            <div style={{ padding: 14, display: "grid", gap: 8 }}>
              <Skeleton height={20} />
              <Skeleton height={20} />
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 18, fontSize: 12.5, color: "var(--text-muted)" }}>{t("empty")}</div>
          ) : (
            items.map((run, i) => (
              <div
                key={run.id}
                data-testid="run-row"
                data-run={run.id}
                ref={i === sentinelAt ? (sentinelRef as unknown as React.Ref<HTMLDivElement>) : undefined}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 10,
                  padding: "10px 14px",
                  alignItems: "center",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span className="mono" style={{ ...cell, color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {run.status === "failed" && (
                    <span data-testid="run-failed" title={run.error ?? t("failed")} style={{ color: "var(--crit)", display: "inline-flex" }}>
                      <Icon.AlertOctagon size={13} />
                    </span>
                  )}
                  {formatTimestamp(run.ranAt, tz)}
                </span>
                <PrCell pr={run.pr} />
                <span className="mono tnum" style={cell}>{formatTokens(totalTokens(run.tokensIn, run.tokensOut))}</span>
                <span className="mono tnum" style={{ ...cell, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {formatUsd(run.costUsd)}
                  <CostSourceBadge source={run.costSource === "api" ? "billed" : run.costSource === "estimate" ? "estimated" : null} />
                </span>
                <span className="tnum" style={cell}>{run.findingsCount ?? "—"}</span>
                <Badge color={run.source === "ci" ? "var(--warn)" : "var(--text-secondary)"}>
                  {run.source === "ci" ? t("ci") : t("local")}
                </Badge>
                <TraceCell run={run} onOpen={() => setTraceRun(run)} />
              </div>
            ))
          )}
          {q.isFetchingNextPage && <div style={{ padding: 10, fontSize: 11.5, color: "var(--text-muted)" }}>{t("loadingMore")}</div>}
        </div>
      </div>
      {traceRun && <TraceDrawer run={traceRun} agentName={agentName} onClose={() => setTraceRun(null)} />}
    </div>
  );
}
