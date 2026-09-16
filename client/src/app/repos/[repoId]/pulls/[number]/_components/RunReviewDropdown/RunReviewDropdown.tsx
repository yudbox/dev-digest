/* RunReviewDropdown — "PICK AGENTS TO RUN" checkbox panel (AC-1 through AC-10).
   N=1 selected → POST /pulls/:id/review (existing, stay on page)
   N≥2 selected → POST /pulls/:id/multi-agent-run → redirect to /multi-agent-review/[runId] */
"use client";

import React from "react";
import { useRouter, useParams } from "next/navigation";
import { Icon } from "@devdigest/ui";
import { Checkbox } from "@devdigest/ui";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import {
  useRunReview,
  useRunMultiAgentReview,
} from "../../../../../../../lib/hooks/reviews";
import { SelectAllClearAllControl } from "../../../../../../../components/agent-picker/SelectAllClearAllControl";
import type { Agent } from "@devdigest/shared";

function formatMs(ms: number | null | undefined): string {
  if (!ms) return "~?s";
  return `~${Math.round(ms / 1000)}s`;
}

function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return "";
  return `$${usd.toFixed(2)}`;
}

export function RunReviewDropdown({
  prId,
  warnMerged = false,
  onRunsStarted,
}: {
  prId: string;
  warnMerged?: boolean;
  onRunsStarted?: (runIds: string[]) => void;
}) {
  const router = useRouter();
  const { repoId } = useParams<{ repoId: string }>();
  const { data: agents } = useAgents();
  const runSingle = useRunReview();
  const runMulti = useRunMultiAgentReview();
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const ref = React.useRef<HTMLDivElement>(null);

  const all: Agent[] = agents ?? [];

  // Initialise all checked when agents load
  React.useEffect(() => {
    if (all.length > 0) setChecked(new Set(all.map((a) => a.id)));
  }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const n = checked.size;
  const isPending = runSingle.isPending || runMulti.isPending;

  // Summary line: max(avg_duration_ms) time, sum(avg_cost_usd) cost
  const selectedAgents = all.filter((a) => checked.has(a.id));
  const estMs = selectedAgents.reduce(
    (m, a) => Math.max(m, a.avg_duration_ms ?? 0),
    0,
  );
  const estCost = selectedAgents.reduce((s, a) => s + (a.avg_cost_usd ?? 0), 0);

  const buttonLabel =
    n === 0
      ? "Run Review"
      : n === 1
        ? `Run ${all.find((a) => checked.has(a.id))?.name ?? "Review"}`
        : `Run multi-agent review (${n})`;

  const handleRun = async () => {
    if (n === 0 || isPending) return;
    setOpen(false);
    if (n === 1) {
      const agentId = [...checked][0]!;
      const res = await runSingle.mutateAsync({ prId, agentId });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
    } else {
      const res = await runMulti.mutateAsync({ prId, agentIds: [...checked] });
      router.push(
        `/repos/${repoId}/multi-agent-review/${res.multi_agent_run_id}`,
      );
    }
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={
          warnMerged ? "PR is merged — review is informational" : undefined
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          border: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          opacity: warnMerged ? 0.7 : 1,
        }}
      >
        <Icon.Sparkles size={14} />
        Run Review
        <Icon.ChevronDown size={14} />
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 320,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            zIndex: 100,
            overflow: "hidden",
          }}
        >
          {/* Merged warning */}
          {warnMerged && (
            <div
              style={{
                padding: "8px 14px",
                background: "var(--warn-bg)",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
                color: "var(--warn)",
                display: "flex",
                gap: 6,
                alignItems: "center",
              }}
            >
              <Icon.AlertTriangle size={13} />
              Already merged — review is informational
            </div>
          )}

          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px 6px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              Pick agents to run
            </span>
            <SelectAllClearAllControl
              total={all.length}
              selected={n}
              onSelectAll={() => setChecked(new Set(all.map((a) => a.id)))}
              onClearAll={() => setChecked(new Set())}
            />
          </div>

          {/* Agent list */}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {all.length === 0 ? (
              <div
                style={{
                  padding: "16px 14px",
                  fontSize: 13,
                  color: "var(--text-muted)",
                  textAlign: "center",
                }}
              >
                No agents —{" "}
                <a href="/agents" style={{ color: "var(--accent-text)" }}>
                  create one
                </a>
              </div>
            ) : (
              all.map((a) => (
                <div
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 14px",
                    cursor: "pointer",
                    borderBottom:
                      "1px solid var(--border-subtle, var(--border))",
                    background: checked.has(a.id)
                      ? "var(--accent-bg)"
                      : "transparent",
                    transition: "background 0.1s",
                  }}
                >
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={checked.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {a.name}
                    </div>
                    {a.description && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {a.description}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatMs(a.avg_duration_ms)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {/* Summary line */}
            {n > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                ≈ {formatMs(estMs)}
                {estCost > 0 ? ` · ${formatUsd(estCost)}` : ""}
                {n > 1 ? " · parallel fan-out" : ""}
              </div>
            )}

            <button
              type="button"
              disabled={n === 0 || isPending}
              onClick={handleRun}
              style={{
                padding: "8px 0",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: n === 0 ? "not-allowed" : "pointer",
                border: "none",
                background: n === 0 ? "var(--bg-surface)" : "var(--accent)",
                color: n === 0 ? "var(--text-muted)" : "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "background 0.15s",
              }}
            >
              <Icon.Users size={14} />
              {isPending ? "Running…" : buttonLabel}
            </button>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/agents");
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-muted)",
                padding: "2px 0",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon.Settings size={11} />
              Configure agents…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
