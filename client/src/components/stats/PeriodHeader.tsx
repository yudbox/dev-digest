"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { StatsWindow } from "@devdigest/shared";
import { formatWindowCaption } from "@/lib/utils/period";
import { PeriodSelect } from "./PeriodSelect";
import { SyncCiButton } from "./SyncCiButton";

/** Period selector + the exact window it resolved to, plus Sync CI when CI is set up. */
export function PeriodHeader({
  window,
  showSyncCi = false,
}: {
  window?: StatsWindow;
  /** True only when the workspace has a CI installation. */
  showSyncCi?: boolean;
}) {
  const t = useTranslations("stats");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      {window && (
        <span data-testid="window-caption" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {formatWindowCaption(window, t)}
        </span>
      )}
      {showSyncCi && <SyncCiButton />}
      <PeriodSelect />
    </div>
  );
}
