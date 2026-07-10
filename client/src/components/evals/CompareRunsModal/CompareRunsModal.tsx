/* CompareRunsModal — metric deltas + GitHub-style LCS diff of `system_prompt`
   between two selected batch runs, via the existing `parsePatch`+`CodeLine`
   (AC-20). "Promote" applies the newer selected version's prompt via the
   existing `PUT /agents/:id` (Q8/AC-21). Agent-only (never mounted for
   skills — skills have no versioned system_prompt to diff). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Icon, Badge } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentVersions, usePromoteAgentPrompt } from "@/lib/hooks/evals";
import { parsePatch } from "@/components/diff-viewer/helpers";
import { CodeLine } from "@/components/diff-viewer/CodeLine";
import { buildPromptDiffPatch } from "@/lib/diff/lcs-diff";
import type { EvalBatchRow } from "../RunsTable/helpers";
import { orderByRanAt, computeDeltas, type MetricDelta } from "./helpers";

function DeltaCard({ delta, label }: { delta: MetricDelta; label: string }) {
  const isCost = delta.key === "cost_usd";
  const d = delta.delta;
  const flat = d == null || d === 0;
  // For cost, lower is better (down = good); for quality metrics, higher is
  // better (up = good).
  const good = d != null && (isCost ? d < 0 : d > 0);
  const color = flat ? "var(--text-muted)" : good ? "var(--ok)" : "var(--crit)";
  const ArrowIcon = flat ? Icon.Slash : d! > 0 ? Icon.ArrowUp : Icon.ArrowDown;

  const fmt = (v: number | null) =>
    v == null ? "–" : isCost ? `$${v.toFixed(2)}` : `${Math.round(v * 100)}%`;

  const fmtDelta = () => {
    if (d == null) return null;
    return isCost
      ? `$${Math.abs(d).toFixed(2)}`
      : `${Math.abs(Math.round(d * 100))}pt`;
  };

  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.05em",
          marginBottom: 8,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          className="tnum"
          style={{ fontSize: 14, color: "var(--text-secondary)" }}
        >
          {fmt(delta.older)}
        </span>
        <Icon.ArrowRight
          size={12}
          style={{ color: "var(--text-muted)", flexShrink: 0 }}
        />
        <span className="tnum" style={{ fontSize: 14, fontWeight: 700 }}>
          {fmt(delta.newer)}
        </span>
        {fmtDelta() != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              color,
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            <ArrowIcon size={12} />
            {fmtDelta()}
          </span>
        )}
      </div>
    </div>
  );
}

export function CompareRunsModal({
  agent,
  batchA,
  batchB,
  onClose,
}: {
  agent: Agent;
  batchA: EvalBatchRow;
  batchB: EvalBatchRow;
  onClose: () => void;
}) {
  const t = useTranslations("eval.compare");
  const { data: versions } = useAgentVersions(agent.id);
  const promote = usePromoteAgentPrompt(agent.id);

  const { older, newer } = orderByRanAt(batchA, batchB);
  const deltas = computeDeltas(older, newer);

  const olderPrompt = versions?.find((v) => v.version === older.agent_version);
  const newerPrompt = versions?.find((v) => v.version === newer.agent_version);

  const patch =
    olderPrompt && newerPrompt
      ? buildPromptDiffPatch(
          olderPrompt.system_prompt,
          newerPrompt.system_prompt,
        )
      : null;
  const lines = patch ? parsePatch(patch) : [];

  const promoteDisabled =
    newer.agent_version == null || newer.agent_version === agent.version;

  return (
    <Modal
      width={860}
      title={`${t("title")} · v${older.agent_version ?? "?"} → v${newer.agent_version ?? "?"}`}
      subtitle={t("subtitle")}
      onClose={onClose}
      footer={
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
        >
          <Button kind="secondary" size="sm" onClick={onClose}>
            {t("close")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="GitMerge"
            disabled={promoteDisabled || !newerPrompt}
            loading={promote.isPending}
            title={promoteDisabled ? t("alreadyCurrent") : undefined}
            onClick={() =>
              newerPrompt && promote.mutate(newerPrompt.system_prompt)
            }
          >
            {t("promote", { version: newer.agent_version ?? "?" })}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {deltas.map((d) => (
            <DeltaCard key={d.key} delta={d} label={t(`deltas.${d.key}`)} />
          ))}
        </div>

        {patch ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <Icon.FileText
                size={13}
                style={{ color: "var(--text-muted)", flexShrink: 0 }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  letterSpacing: "0.06em",
                }}
              >
                {t("diffHeader")}
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginLeft: 4,
                }}
              >
                <Badge mono color="var(--crit)" bg="transparent">
                  ● v{older.agent_version} (old)
                </Badge>
                <Badge mono color="var(--ok)" bg="transparent">
                  ● v{newer.agent_version} (new)
                </Badge>
              </div>
            </div>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {lines.map((ln, i) => (
                <CodeLine key={i} ln={ln} path="system_prompt" threads={[]} />
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("noVersionData")}
          </p>
        )}
      </div>
    </Modal>
  );
}
