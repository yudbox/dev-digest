"use client";

import React from "react";
import { Card, SectionLabel, StackedBar } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { AgentStatsResponse } from "@devdigest/shared";
import { CategoryDonut } from "@/components/stats";
import { toSeverityBars } from "./helpers";

/** Findings by severity: one stacked column per bucket of the selected period. */
export function SeverityCard({ data }: { data: AgentStatsResponse }) {
  const t = useTranslations("agents.stats.severity");
  const ts = useTranslations("stats");
  return (
    <Card>
      <SectionLabel icon="BarChart">{t("title")}</SectionLabel>
      <StackedBar
        data={toSeverityBars(data.severityBuckets, data.window, ts)}
        legendLabels={{
          critical: ts("severity.critical"),
          warning: ts("severity.warning"),
          suggestion: ts("severity.suggestion"),
        }}
      />
      <div data-testid="severity-caption" style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
        {t("caption", { count: data.findingsTotal })}
      </div>
    </Card>
  );
}

/** Findings by category: all five categories, always. */
export function CategoryCard({ data }: { data: AgentStatsResponse }) {
  const t = useTranslations("agents.stats.category");
  return (
    <Card>
      <SectionLabel icon="Tag">{t("title")}</SectionLabel>
      <div style={{ display: "grid", placeItems: "center", paddingTop: 6 }}>
        <CategoryDonut categories={data.categories} />
      </div>
    </Card>
  );
}
