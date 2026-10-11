"use client";

import React from "react";
import { EmptyState, ErrorState, Skeleton, type IconName } from "@devdigest/ui";
import { useTranslations } from "next-intl";

/**
 * Loading placeholder: grey bars only — never a number, a zero or a dash, so
 * a screen that has not loaded can never look like a screen with no activity.
 */
export function StatsSkeleton({ cards = 4, rows = 3 }: { cards?: number; rows?: number }) {
  return (
    <div data-testid="stats-skeleton" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 14 }}>
        {Array.from({ length: cards }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              padding: 16,
              borderRadius: 9,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              display: "grid",
              gap: 12,
            }}
          >
            <Skeleton width="55%" height={11} />
            <Skeleton width="40%" height={28} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height={38} />
        ))}
      </div>
    </div>
  );
}

/** Failed load: a message and Retry that repeats only the failed request. No numbers. */
export function StatsError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("stats.state");
  return <ErrorState title={t("errorTitle")} body={t("errorBody")} onRetry={onRetry} />;
}

/** Empty state: text only — deliberately no button and no link (stats fill in by themselves). */
export function StatsEmpty({
  title,
  body,
  icon = "Activity",
}: {
  title: string;
  body?: React.ReactNode;
  icon?: IconName;
}) {
  return <EmptyState icon={icon} title={title} body={body} />;
}
