"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { adjustRange, localToday, maxToFor, minFromFor } from "@/lib/utils/period";

const inputStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  colorScheme: "dark",
};

/**
 * Two date inputs for a custom range. `min`/`max` make a range longer than 30
 * days (or one reaching into the future) impossible to pick; typed values are
 * clamped the same way by `adjustRange`.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  today = localToday(),
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  today?: string;
}) {
  const t = useTranslations("stats.period");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
        {t("from")}
        <input
          type="date"
          aria-label={t("from")}
          value={from}
          min={minFromFor(to)}
          max={to}
          onChange={(e) => e.target.value && onChange(adjustRange({ from: e.target.value, to }, "from", today))}
          style={inputStyle}
        />
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
        {t("to")}
        <input
          type="date"
          aria-label={t("to")}
          value={to}
          min={from}
          max={maxToFor(from, today)}
          onChange={(e) => e.target.value && onChange(adjustRange({ from, to: e.target.value }, "to", today))}
          style={inputStyle}
        />
      </label>
      <span style={{ color: "var(--text-muted)" }}>{t("maxDays")}</span>
    </span>
  );
}
