"use client";

import React from "react";
import { Button, Badge, Icon } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useCiInstallations,
  usePatchAgentCiFailOn,
  useUpdateCiConfig,
} from "@/lib/hooks/ci";
import { ExportWizard } from "../ExportWizard";

// ── Status chip ────────────────────────────────────────────────────────────

function RunStatusDot({ status }: { status: string | null | undefined }) {
  if (!status)
    return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>;

  const colors: Record<string, string> = {
    succeeded: "var(--ok)",
    no_findings: "var(--text-muted)",
    failed: "var(--crit)",
    running: "var(--accent)",
  };
  const labels: Record<string, string> = {
    succeeded: "succeeded",
    no_findings: "no findings",
    failed: "failed",
    running: "running",
  };
  const color = colors[status] ?? "var(--text-muted)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      {labels[status] ?? status}
    </span>
  );
}

// ── Fail CI on selector ────────────────────────────────────────────────────

const FAIL_ON_OPTIONS = [
  {
    value: "critical",
    label: "Critical",
    description: "Block only on critical findings",
  },
  {
    value: "warning",
    label: "Warning+",
    description: "Block on critical or warning",
  },
  { value: "never", label: "Never", description: "Never block — comment only" },
] as const;

type FailOnValue = "critical" | "warning" | "never";

function FailCiOnSelector({
  agentId,
  currentValue,
}: {
  agentId: string;
  currentValue: string | null | undefined;
}) {
  const patch = usePatchAgentCiFailOn(agentId);
  const value: FailOnValue =
    (currentValue as FailOnValue | null | undefined) ?? "critical";

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 4,
          }}
        >
          Fail CI on
        </div>
        <div
          style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 400 }}
        >
          Exit non-zero when a finding at or above this severity lands. Pair
          with a required status check to block merges.
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {FAIL_ON_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            title={opt.description}
            onClick={() => patch.mutate(opt.value)}
            disabled={patch.isPending}
            style={{
              padding: "6px 14px",
              borderRadius: 7,
              border:
                value === opt.value
                  ? "1.5px solid var(--accent)"
                  : "1px solid var(--border)",
              background:
                value === opt.value ? "var(--accent-bg)" : "transparent",
              color:
                value === opt.value ? "var(--accent)" : "var(--text-secondary)",
              fontSize: 13,
              fontWeight: value === opt.value ? 600 : 400,
              cursor: patch.isPending ? "wait" : "pointer",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main CiTab ─────────────────────────────────────────────────────────────

export function CiTab({ agent }: { agent: Agent }) {
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const { data, isLoading, refetch } = useCiInstallations(agent.id);
  const updateConfig = useUpdateCiConfig(agent.id);

  const installations = data?.installations ?? [];
  const activeCount =
    (data as Record<string, unknown> & { activeCount?: number })?.activeCount ??
    data?.active_count ??
    0;
  const hasInstallations = installations.length > 0;

  function formatDate(s: string | null | undefined) {
    if (!s) return "";
    return new Date(s).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function relativeTime(s: string | null | undefined) {
    if (!s) return null;
    const diff = Date.now() - new Date(s).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            CI deployment
          </span>
          {!isLoading && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 10px",
                borderRadius: 20,
                background:
                  activeCount > 0 ? "rgba(34,197,94,.15)" : "var(--bg-hover)",
                fontSize: 12,
                fontWeight: 600,
                color: activeCount > 0 ? "var(--ok)" : "var(--text-muted)",
              }}
            >
              {activeCount > 0 && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--ok)",
                    display: "inline-block",
                  }}
                />
              )}
              Active in {activeCount} {activeCount === 1 ? "repo" : "repos"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Update CI config — disabled if no installations */}
          <span
            title={
              !hasInstallations ? "No repos yet — use Add to CI" : undefined
            }
          >
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              disabled={!hasInstallations || updateConfig.isPending}
              loading={updateConfig.isPending}
              onClick={() => updateConfig.mutate()}
            >
              Update CI config
            </Button>
          </span>
          <Button
            kind="primary"
            size="sm"
            icon="GitBranch"
            onClick={() => setWizardOpen(true)}
          >
            Add to CI
          </Button>
        </div>
      </div>

      {/* Subtitle */}
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
        Run this agent automatically on pull requests in a target repository.
      </p>

      {/* Fail CI on selector */}
      <FailCiOnSelector agentId={agent.id} currentValue={agent.ci_fail_on} />

      {/* Installations list */}
      <div>
        {isLoading && (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Loading…
          </div>
        )}

        {!isLoading && installations.length === 0 && (
          <div
            style={{
              padding: "24px",
              borderRadius: 10,
              border: "1px dashed var(--border)",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            Not deployed to CI yet. Use "Add to CI" to open a PR that adds the
            workflow.
          </div>
        )}

        {installations.length > 0 && (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {installations.map((inst, idx) => (
              <div
                key={inst.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto auto",
                  alignItems: "center",
                  gap: 16,
                  padding: "12px 18px",
                  borderBottom:
                    idx < installations.length - 1
                      ? "1px solid var(--border)"
                      : "none",
                  background: "var(--bg-surface)",
                }}
              >
                {/* Repo + platform */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon.GitBranch
                    size={13}
                    style={{ color: "var(--text-muted)", flexShrink: 0 }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    {inst.repo}
                  </span>
                </div>

                {/* Platform badge */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 5,
                    background: "var(--bg-hover)",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon.GitBranch size={11} />
                  {inst.target_type === "gha"
                    ? "GitHub Actions"
                    : inst.target_type}
                </span>

                {/* Status */}
                <RunStatusDot status={inst.last_run_status} />

                {/* Relative time */}
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {relativeTime(inst.last_ran_at) ??
                    formatDate(inst.installed_at)}
                </span>

                {/* Re-export trigger */}
                <Button
                  kind="ghost"
                  size="sm"
                  icon="RefreshCw"
                  onClick={() => setWizardOpen(true)}
                >
                  Re-export
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add repository CTA */}
        <button
          onClick={() => setWizardOpen(true)}
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 7,
            border: "1px dashed var(--border)",
            background: "transparent",
            color: "var(--accent)",
            fontSize: 13,
            cursor: "pointer",
            width: "100%",
            justifyContent: "center",
          }}
        >
          <Icon.Plus size={14} />
          Add repository
        </button>
      </div>

      {/* Export Wizard modal */}
      {wizardOpen && (
        <ExportWizard
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
