/* /ci — CI Runs page. Shows all CI-executed agent reviews across repos. */
"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button, Skeleton, Icon, EmptyState } from "@devdigest/ui";
import { SeverityChip } from "@/components/SeverityChip/SeverityChip";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import type { CiRun, CiRunsQuery } from "@devdigest/shared";
import { FindingsPopover } from "@/app/repos/[repoId]/pulls/_components/FindingsPopover/FindingsPopover";

// ── Constants ────────────────────────────────────────────────────────────────

const TARGET_LABELS: Record<string, string> = {
  gha: "GitHub Actions",
  circle: "CircleCI",
  jenkins: "Jenkins",
  cli: "CLI",
};

const STATUS_LABELS: Record<string, string> = {
  succeeded: "Succeeded",
  no_findings: "No findings",
  failed: "Failed",
  running: "Running",
};

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  succeeded: { fg: "var(--ok)", bg: "var(--ok-bg)" },
  no_findings: { fg: "var(--text-muted)", bg: "var(--bg-hover)" },
  failed: { fg: "var(--crit)", bg: "rgba(239,68,68,.1)" },
  running: { fg: "var(--accent)", bg: "rgba(59,130,246,.1)" },
};

const CRUMB = [{ label: "Skills Lab" }, { label: "CI Runs" }];

const TD: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateRangeFrom(range: string): Pick<CiRunsQuery, "from" | "to"> {
  if (range === "all") return {};
  const days = parseInt(range, 10);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return { from: d.toISOString().split("T")[0] };
}

function formatRanAt(s: string | null | undefined): string {
  if (!s) return "–";
  return new Date(s).toLocaleString();
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "–";
  return (ms / 1000).toFixed(1) + "s";
}

function formatCost(usd: number | null | undefined): string {
  if (usd == null || usd <= 0) return "–";
  return "$" + usd.toFixed(2);
}

function formatSyncedLabel(syncedAt: Date): string {
  const diffMin = Math.floor((Date.now() - syncedAt.getTime()) / 60_000);
  return diffMin < 1 ? "just now" : `${diffMin}m ago`;
}

// ── SyncedPill ────────────────────────────────────────────────────────────────

function SyncedPill({ syncedAt }: { syncedAt: Date }) {
  const [, tick] = useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        borderRadius: 7,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        fontSize: 13,
        color: "var(--text-secondary)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: "var(--ok)",
          boxShadow: "0 0 0 3px var(--ok-bg)",
          animation: "ddpulse 2s ease-in-out infinite",
        }}
      />
      <span>
        synced{" "}
        <b style={{ color: "var(--ok)", fontWeight: 600 }}>
          {formatSyncedLabel(syncedAt)}
        </b>
      </span>
    </div>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span style={{ color: "var(--text-muted)" }}>–</span>;
  const label = STATUS_LABELS[status] ?? status;
  const colors = STATUS_COLORS[status] ?? {
    fg: "var(--text-muted)",
    bg: "var(--bg-hover)",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        background: colors.bg,
        color: colors.fg,
      }}
    >
      {label}
    </span>
  );
}

// ── FilterSelect ──────────────────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "6px 10px",
        fontSize: 13,
        color: "var(--text-primary)",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── TracePanel ────────────────────────────────────────────────────────────────

function TracePanelRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
        {children}
      </span>
    </div>
  );
}

function TracePanel({ run, onClose }: { run: CiRun; onClose: () => void }) {
  const source = run.target_type
    ? (TARGET_LABELS[run.target_type] ?? run.target_type)
    : "–";

  const panel = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
        }}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: 420,
          maxWidth: "100vw",
          height: "100%",
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--border)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            Run Trace
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
            aria-label="Close"
          >
            <Icon.X size={16} />
          </button>
        </div>
        {/* Body */}
        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            flex: 1,
          }}
        >
          <TracePanelRow label="AGENT">{run.agent ?? "–"}</TracePanelRow>
          <TracePanelRow label="PULL REQUEST">
            {run.pr_number
              ? `#${run.pr_number}${run.pr_title ? ` — ${run.pr_title}` : ""}`
              : "–"}
          </TracePanelRow>
          <TracePanelRow label="REPOSITORY">{run.repo ?? "–"}</TracePanelRow>
          <TracePanelRow label="SOURCE">{source}</TracePanelRow>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
              }}
            >
              STATUS
            </span>
            <StatusBadge status={run.status} />
          </div>
          <TracePanelRow label="DURATION">
            {formatDuration(run.duration_ms)}
          </TracePanelRow>
          <TracePanelRow label="COST">{formatCost(run.cost_usd)}</TracePanelRow>
          {/* Severity breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
              }}
            >
              FINDINGS
            </span>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {(run.critical ?? 0) > 0 && (
                <SeverityChip sev="CRITICAL" count={run.critical!} />
              )}
              {(run.warning ?? 0) > 0 && (
                <SeverityChip sev="WARNING" count={run.warning!} />
              )}
              {(run.suggestion ?? 0) > 0 && (
                <SeverityChip sev="SUGGESTION" count={run.suggestion!} />
              )}
              {(run.critical ?? 0) === 0 &&
                (run.warning ?? 0) === 0 &&
                (run.suggestion ?? 0) === 0 && (
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    None
                  </span>
                )}
            </div>
          </div>
          {/* GitHub link */}
          {run.github_url && (
            <a
              href={run.github_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                color: "var(--accent)",
                textDecoration: "none",
                marginTop: "auto",
                paddingTop: 8,
              }}
            >
              View full logs on GitHub Actions
              <Icon.ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

// ── CiRunRow ──────────────────────────────────────────────────────────────────

function CiRunRow({
  run,
  isLast,
  onTrace,
}: {
  run: CiRun;
  isLast: boolean;
  onTrace: () => void;
}) {
  const source = run.target_type
    ? (TARGET_LABELS[run.target_type] ?? run.target_type)
    : "–";
  const [findingsAnchor, setFindingsAnchor] = useState<HTMLElement | null>(
    null,
  );
  const hasFindings = (run.findings ?? []).length > 0;

  return (
    <tr
      style={{ borderBottom: isLast ? "none" : "1px solid var(--border)" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "";
      }}
    >
      {/* TIMESTAMP */}
      <td style={TD}>
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
          {formatRanAt(run.ran_at)}
        </span>
      </td>
      {/* PULL REQUEST */}
      <td style={TD}>
        {run.pr_number ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>#{run.pr_number}</span>
            {run.pr_title && (
              <span
                style={{
                  color: "var(--text-secondary)",
                  maxWidth: 200,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {run.pr_title}
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>–</span>
        )}
      </td>
      {/* AGENT */}
      <td style={TD}>
        {run.agent ?? <span style={{ color: "var(--text-muted)" }}>–</span>}
      </td>
      {/* SOURCE */}
      <td style={TD}>{source}</td>
      {/* DUR. */}
      <td style={{ ...TD, fontFamily: "monospace" }}>
        {formatDuration(run.duration_ms)}
      </td>
      {/* FINDINGS */}
      <td
        style={{ ...TD, cursor: hasFindings ? "pointer" : undefined }}
        onClick={(e) => {
          if (!hasFindings) return;
          e.stopPropagation();
          setFindingsAnchor((prev) =>
            prev ? null : (e.currentTarget as HTMLElement),
          );
        }}
      >
        {findingsAnchor && hasFindings && (
          <FindingsPopover
            review={{ findings: run.findings ?? [] } as never}
            isLoading={false}
            anchorRect={findingsAnchor.getBoundingClientRect()}
            onClose={() => setFindingsAnchor(null)}
          />
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {(run.critical ?? 0) > 0 && (
            <SeverityChip sev="CRITICAL" count={run.critical!} />
          )}
          {(run.warning ?? 0) > 0 && (
            <SeverityChip sev="WARNING" count={run.warning!} />
          )}
          {(run.suggestion ?? 0) > 0 && (
            <SeverityChip sev="SUGGESTION" count={run.suggestion!} />
          )}
          {(run.critical ?? 0) === 0 &&
            (run.warning ?? 0) === 0 &&
            (run.suggestion ?? 0) === 0 && (
              <span style={{ color: "var(--text-muted)" }}>–</span>
            )}
        </div>
      </td>
      {/* COST */}
      <td style={{ ...TD, fontFamily: "monospace" }}>
        {formatCost(run.cost_usd)}
      </td>
      {/* STATUS */}
      <td style={TD}>
        <StatusBadge status={run.status} />
      </td>
      {/* TRACE */}
      <td style={TD}>
        <Button kind="ghost" size="sm" onClick={onTrace}>
          Trace
        </Button>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CiRunsPage() {
  const router = useRouter();
  const [dateRange, setDateRange] = useState("7");
  const [agentFilter, setAgentFilter] = useState("");
  const [repoFilter, setRepoFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [traceRun, setTraceRun] = useState<CiRun | null>(null);

  const dateRangeParams = dateRangeFrom(dateRange);
  const filters: CiRunsQuery = {
    ...dateRangeParams,
    agent: agentFilter || undefined,
    repo: repoFilter || undefined,
    status: statusFilter || undefined,
    source: sourceFilter || undefined,
  };

  const { data, isLoading, isError, refetch } = useCiRuns(filters);
  const refresh = useRefreshCiRuns();

  const runs = data?.runs ?? [];

  const agentOptions = Array.from(
    new Set(runs.map((r) => r.agent).filter((a): a is string => !!a)),
  );
  const repoOptions = Array.from(
    new Set(runs.map((r) => r.repo).filter((r): r is string => !!r)),
  );

  async function handleRefresh() {
    try {
      await refresh.mutateAsync(undefined);
      setSyncedAt(new Date());
    } catch {
      // mutation errors are surfaced via refresh.isError
    }
  }

  return (
    <AppShell crumb={CRUMB}>
      <div
        style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              CI Runs
            </h1>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                margin: "4px 0 0",
              }}
            >
              Agent reviews executed inside CI · not local runs
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {syncedAt && <SyncedPill syncedAt={syncedAt} />}
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={refresh.isPending}
              onClick={handleRefresh}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Filters ── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <FilterSelect
            value={dateRange}
            onChange={setDateRange}
            options={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
              { value: "all", label: "All time" },
            ]}
          />
          <FilterSelect
            value={agentFilter}
            onChange={setAgentFilter}
            options={[
              { value: "", label: "All agents" },
              ...agentOptions.map((a) => ({ value: a, label: a })),
            ]}
          />
          <FilterSelect
            value={repoFilter}
            onChange={setRepoFilter}
            options={[
              { value: "", label: "All repos" },
              ...repoOptions.map((r) => ({ value: r, label: r })),
            ]}
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "", label: "All statuses" },
              { value: "succeeded", label: "Succeeded" },
              { value: "no_findings", label: "No findings" },
              { value: "failed", label: "Failed" },
              { value: "running", label: "Running" },
            ]}
          />
          <FilterSelect
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: "", label: "All sources" },
              { value: "gha", label: "GitHub Actions" },
              { value: "circle", label: "CircleCI" },
              { value: "jenkins", label: "Jenkins" },
              { value: "cli", label: "CLI" },
            ]}
          />
        </div>

        {/* ── Loading ── */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div
            style={{
              fontSize: 13,
              color: "var(--crit)",
              padding: "12px 0",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Failed to load CI runs.
            <button
              onClick={() => refetch()}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && !isError && runs.length === 0 && (
          <EmptyState
            icon="GitBranch"
            title="No CI runs yet"
            body="Once you export an agent to CI, every automated review shows up here."
            cta="+ Set up CI for an agent"
            onCta={() => router.push("/agents")}
          />
        )}

        {/* ── Table ── */}
        {runs.length > 0 && (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {[
                    "TIMESTAMP",
                    "PULL REQUEST",
                    "AGENT",
                    "SOURCE",
                    "DUR.",
                    "FINDINGS",
                    "COST",
                    "STATUS",
                    "",
                  ].map((col, i) => (
                    <th
                      // eslint-disable-next-line react/no-array-index-key
                      key={i}
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => (
                  <CiRunRow
                    key={run.id}
                    run={run}
                    isLast={i === runs.length - 1}
                    onTrace={() => setTraceRun(run)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {traceRun && (
        <TracePanel run={traceRun} onClose={() => setTraceRun(null)} />
      )}
    </AppShell>
  );
}
