"use client";

import React from "react";
import { SectionLabel, Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { Intent, RiskAreaKind } from "@devdigest/shared";
import type { CSSProperties } from "react";

const RISK_ICONS: Record<
  RiskAreaKind,
  { icon: keyof typeof Icon; color: string }
> = {
  security: { icon: "Shield", color: "#ef4444" },
  dependency: { icon: "Layers", color: "#f97316" },
  performance: { icon: "Cpu", color: "#eab308" },
  data: { icon: "FileText", color: "#8b5cf6" },
  api_change: { icon: "Wrench", color: "#3b82f6" },
  other: { icon: "AlertTriangle", color: "#6b7280" },
};

interface IntentCardProps {
  intent: Intent | null | undefined;
  isLoading: boolean;
  onRecalculate: () => void;
  recalculating: boolean;
}

const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    height: "100%",
    boxSizing: "border-box",
  } satisfies CSSProperties,

  quote: {
    fontStyle: "italic",
    color: "var(--text-primary)",
    fontSize: 14,
    lineHeight: 1.55,
    margin: 0,
  } satisfies CSSProperties,

  // Two-column row
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  } satisfies CSSProperties,

  colHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: 6,
  } satisfies CSSProperties,

  colHeaderIn: {
    color: "var(--color-success, #4ade80)",
  } satisfies CSSProperties,
  colHeaderOut: { color: "var(--text-muted)" } satisfies CSSProperties,

  itemList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  itemIn: {
    fontSize: 13,
    color: "var(--text-secondary)",
    paddingLeft: 0,
    lineHeight: 1.45,
    listStyleType: "none",
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
  } satisfies CSSProperties,

  itemInDot: {
    color: "var(--color-success, #4ade80)",
    flexShrink: 0,
    marginTop: 2,
    fontSize: 14,
  } satisfies CSSProperties,

  itemOut: {
    fontSize: 13,
    color: "var(--text-muted)",
    paddingLeft: 0,
    lineHeight: 1.45,
    listStyleType: "none",
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
  } satisfies CSSProperties,

  itemOutDot: {
    color: "var(--text-muted)",
    flexShrink: 0,
    marginTop: 2,
    fontSize: 14,
  } satisfies CSSProperties,

  recalcBtn: {
    marginTop: 2,
    fontSize: 11,
    color: "var(--text-muted)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    alignSelf: "flex-start",
  } satisfies CSSProperties,

  emptyTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  emptyBody: {
    margin: 0,
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  divider: {
    borderTop: "1px solid var(--border)",
    margin: "2px 0",
  } satisfies CSSProperties,

  riskLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,

  riskChips: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
  } satisfies CSSProperties,

  riskChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "2px 7px",
    lineHeight: 1.6,
  } satisfies CSSProperties,
};

export function IntentCard({
  intent,
  isLoading,
  onRecalculate,
  recalculating,
}: IntentCardProps) {
  const t = useTranslations("prReview.intent");

  if (isLoading) return null;

  if (!intent) {
    return (
      <section style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <SectionLabel icon="Target">Intent</SectionLabel>
        <div style={s.card}>
          <p style={s.emptyTitle}>{t("notRunTitle")}</p>
          <p style={s.emptyBody}>{t("notRunBody")}</p>
        </div>
      </section>
    );
  }

  const hasScope = intent.in_scope.length > 0 || intent.out_of_scope.length > 0;

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SectionLabel icon="Target">Intent</SectionLabel>
      <div style={s.card}>
        {/* Quote */}
        <p style={s.quote}>&ldquo;{intent.intent}&rdquo;</p>

        {/* Two-column scope grid */}
        {hasScope && (
          <div style={s.columns}>
            {/* IN SCOPE */}
            <div>
              <div style={{ ...s.colHeader, ...s.colHeaderIn }}>
                <span>✓</span>
                <span>In scope</span>
              </div>
              <ul style={s.itemList}>
                {intent.in_scope.map((item) => (
                  <li key={item} style={s.itemIn}>
                    <span style={s.itemInDot}>·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* OUT OF SCOPE */}
            <div>
              <div style={{ ...s.colHeader, ...s.colHeaderOut }}>
                <span>×</span>
                <span>Out of scope</span>
              </div>
              <ul style={s.itemList}>
                {intent.out_of_scope.map((item) => (
                  <li key={item} style={s.itemOut}>
                    <span style={s.itemOutDot}>·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Risk Areas */}
        {intent.risk_areas && intent.risk_areas.length > 0 && (
          <>
            <div style={s.divider} />
            <div>
              <div style={s.riskLabel}>⚠ Risk areas</div>
              <div style={s.riskChips}>
                {intent.risk_areas.map((risk) => {
                  const meta = RISK_ICONS[risk.kind] ?? RISK_ICONS.other;
                  const RiskIcon = Icon[meta.icon] as React.FC<{
                    size?: number;
                    style?: React.CSSProperties;
                  }>;
                  return (
                    <span key={risk.title} style={s.riskChip}>
                      <RiskIcon size={11} style={{ color: meta.color }} />
                      {risk.title}
                    </span>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <button
          onClick={onRecalculate}
          disabled={recalculating}
          style={s.recalcBtn}
        >
          {recalculating ? "Recalculating…" : "↻ Recalculate"}
        </button>
      </div>
    </section>
  );
}
