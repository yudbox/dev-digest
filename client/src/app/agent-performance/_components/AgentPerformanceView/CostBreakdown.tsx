"use client";

import React from "react";
import { Donut, SectionLabel, type DonutSegment } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { CostSegment, CostSourceBadge as CostSourceValue } from "@devdigest/shared";
import { CostSourceBadge, agentColor, formatUsd } from "@/components/stats";
import { DELETED_COLOR, MODEL_PALETTE } from "./helpers";

type T = ReturnType<typeof useTranslations>;

function toSegments(items: CostSegment[], noun: "agents" | "models", t: T): DonutSegment[] {
  return items.map((s, i) => {
    let label = s.label;
    if (s.kind === "deleted") label = t("table.deleted");
    else if (s.kind === "unknown_model") label = t("cost.unknownModel");
    else if (s.kind === "other") {
      label = t(noun === "agents" ? "cost.otherAgents" : "cost.otherModels", { count: s.hidden.length });
    }
    const color =
      s.kind === "agent"
        ? agentColor(s.key)
        : s.kind === "deleted"
          ? DELETED_COLOR
          : MODEL_PALETTE[i % MODEL_PALETTE.length]!;
    return {
      label,
      value: s.costUsd,
      color,
      title:
        s.kind === "other" && s.hidden.length > 0
          ? s.hidden.map((h) => `${h.label} ${formatUsd(h.costUsd)}`).join("\n")
          : undefined,
    };
  });
}

/**
 * Cost by agent and by model. Both donuts add up to Total cost (the server
 * guarantees it, including the folded "Other" segment), and the badge says whether
 * the money is billed by the provider or a DevDigest estimate.
 */
export function CostBreakdown({
  byAgent,
  byModel,
  totalCostUsd,
  source,
}: {
  byAgent: CostSegment[];
  byModel: CostSegment[];
  totalCostUsd: number;
  source: CostSourceValue | null;
}) {
  const t = useTranslations("agentPerformance");
  const hasCost = totalCostUsd > 0 && (byAgent.length > 0 || byModel.length > 0);

  return (
    <div data-testid="cost-breakdown">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <SectionLabel icon="DollarSign">{t("cost.title")}</SectionLabel>
        <CostSourceBadge source={source} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {(
          [
            ["byAgent", byAgent, "agents"],
            ["byModel", byModel, "models"],
          ] as const
        ).map(([key, items, noun]) => (
          <div
            key={key}
            data-testid={`donut-${key}`}
            style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elevated)" }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 14 }}>{t(`cost.${key}`)}</div>
            <Donut
              segments={toSegments(items, noun, t)}
              size={120}
              centerLabel={hasCost ? formatUsd(totalCostUsd) : undefined}
              emptyText={t("cost.noCost")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
