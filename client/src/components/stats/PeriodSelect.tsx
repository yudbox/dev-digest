"use client";

import React from "react";
import { Button, Dropdown } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { usePeriod } from "@/lib/contexts/periodContext";
import { defaultCustomRange, localToday } from "@/lib/utils/period";
import { DateRangePicker } from "./DateRangePicker";

/**
 * The ONE period selector (1 day / 30 days / Custom range). It reads and writes
 * the global period, so the same control on Agent Performance, Agent Stats and
 * Skill Stats always shows — and changes — the same value.
 */
export function PeriodSelect() {
  const t = useTranslations("stats.period");
  const { period, setPeriod } = usePeriod();

  const label =
    period.kind === "1d" ? t("oneDay") : period.kind === "30d" ? t("thirtyDays") : t("custom");

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      {period.kind === "custom" && (
        <DateRangePicker
          from={period.from}
          to={period.to}
          onChange={(range) => setPeriod({ kind: "custom", ...range })}
        />
      )}
      <Dropdown
        align="right"
        width={190}
        trigger={
          <Button kind="ghost" size="sm" icon="Calendar" aria-label={t("label")}>
            {label}
          </Button>
        }
        items={[
          { label: t("oneDay"), onClick: () => setPeriod({ kind: "1d" }) },
          { label: t("thirtyDays"), onClick: () => setPeriod({ kind: "30d" }) },
          {
            label: t("custom"),
            onClick: () => setPeriod({ kind: "custom", ...defaultCustomRange(localToday()) }),
          },
        ]}
      />
    </span>
  );
}
