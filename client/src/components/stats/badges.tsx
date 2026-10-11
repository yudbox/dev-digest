"use client";

import React from "react";
import { Badge } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { CostSourceBadge as CostSourceValue } from "@devdigest/shared";
import { SMALL_SAMPLE_DECISIONS } from "./constants";

const COLORS: Record<CostSourceValue, string> = {
  billed: "var(--ok)",
  estimated: "var(--warn)",
  mixed: "var(--accent-text)",
};

/**
 * Where a cost number comes from. Nothing is rendered when no run in scope has a
 * recorded source (old runs) — there is deliberately no "unknown" badge.
 */
export function CostSourceBadge({ source }: { source: CostSourceValue | null | undefined }) {
  const t = useTranslations("stats.costSource");
  if (!source) return null;
  const tip = { billed: t("tipBilled"), estimated: t("tipEstimated"), mixed: t("tipMixed") }[source];
  return (
    <span title={tip} data-testid="cost-source-badge" data-source={source}>
      <Badge color={COLORS[source]}>{t(source)}</Badge>
    </span>
  );
}

export function SmallSampleBadge({ min = SMALL_SAMPLE_DECISIONS }: { min?: number }) {
  const t = useTranslations("stats");
  return (
    <span title={t("smallSampleTip", { min })} data-testid="small-sample-badge">
      <Badge color="var(--warn)">{t("smallSample")}</Badge>
    </span>
  );
}

/** "N runs without cost" — rendered only when there is at least one. */
export function RunsWithoutCost({ count }: { count: number }) {
  const t = useTranslations("stats");
  if (!(count > 0)) return null;
  return (
    <span data-testid="runs-without-cost" style={{ fontSize: 11, color: "var(--text-muted)" }}>
      {t("runsWithoutCost", { count })}
    </span>
  );
}
