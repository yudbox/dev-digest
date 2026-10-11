"use client";

import React from "react";
import { Donut } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { FINDING_CATEGORY_ORDER, type CategoryCount } from "@devdigest/shared";
import { CATEGORY_COLORS, SMALL_SAMPLE_FINDINGS } from "./constants";
import { SmallSampleBadge } from "./badges";

/**
 * Findings by category. Always lists all five categories in a fixed order with
 * integer counts and shares (no currency sign). A category with 0 findings is
 * still drawn as a thin sliver of its colour; the legend keeps the real 0. When
 * every count is 0 the ring is grey and says so in the middle.
 */
export function CategoryDonut({ categories }: { categories: CategoryCount[] }) {
  const t = useTranslations("stats");
  const counts = new Map(categories.map((c) => [c.category, c.count]));
  const total = categories.reduce((sum, c) => sum + c.count, 0);

  const segments = FINDING_CATEGORY_ORDER.map((category) => ({
    label: t(`category.${category}`),
    value: counts.get(category) ?? 0,
    color: CATEGORY_COLORS[category],
  }));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Donut
        segments={segments}
        size={120}
        minVisible
        centerLabel={String(total)}
        emptyText={t("category.noFindings")}
        valueFormatter={(s) => `${s.value} · ${total > 0 ? Math.round((s.value / total) * 100) : 0}%`}
      />
      {total > 0 && total < SMALL_SAMPLE_FINDINGS && (
        <div>
          <SmallSampleBadge min={SMALL_SAMPLE_FINDINGS} />
        </div>
      )}
    </div>
  );
}
