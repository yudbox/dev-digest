"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SectionLabel, Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { Intent, Risk, RiskAreaKind } from "@devdigest/shared";
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

/** Keep last 2 path segments, prefix with …/ when truncated. */
function shortenRef(ref: string): string {
  const path = ref.replace(/:\d+(-\d+)?$/, "");
  const parts = path.split("/");
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function RiskItem({
  risk,
  repoId,
  prNumber,
}: {
  risk: Risk;
  repoId: string;
  prNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const meta = RISK_ICONS[risk.kind as RiskAreaKind] ?? RISK_ICONS.other;
  const RiskIcon = Icon[meta.icon] as React.FC<{
    size?: number;
    style?: React.CSSProperties;
  }>;

  const navigateToRef = (ref: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // ref format: "path/to/file.ts:12-18" or "path/to/file.ts:12" or "path/to/file.ts"
    const colonIdx = ref.lastIndexOf(":");
    const hasLine = colonIdx > 0 && colonIdx > ref.lastIndexOf("/");
    const filePath = hasLine ? ref.slice(0, colonIdx) : ref;
    const lineStr = hasLine ? ref.slice(colonIdx + 1).split("-")[0] : undefined;
    const url = `/repos/${repoId}/pulls/${prNumber}?tab=diff&file=${encodeURIComponent(filePath)}${lineStr ? `&line=${lineStr}` : ""}`;
    router.push(url);
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* ── Accordion header: icon + title + file refs ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "6px 0",
          textAlign: "left",
        }}
      >
        <RiskIcon
          size={11}
          style={{ color: meta.color, flexShrink: 0, marginTop: 2 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-primary)",
              display: "block",
              fontWeight: 500,
            }}
          >
            {risk.title}
          </span>
          {risk.file_refs.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginTop: 3,
              }}
            >
              {risk.file_refs.map((ref) => (
                <span
                  key={ref}
                  onClick={(e) => navigateToRef(ref, e)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    navigateToRef(ref, e as unknown as React.MouseEvent)
                  }
                  title={ref}
                  style={{
                    fontSize: 10,
                    color: "var(--accent-text, #60a5fa)",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    background: "rgba(96, 165, 250, 0.10)",
                    borderRadius: 3,
                    padding: "1px 5px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortenRef(ref)}
                </span>
              ))}
            </div>
          )}
        </div>
        <Icon.ChevronDown
          size={11}
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 0.15s",
            flexShrink: 0,
            marginTop: 2,
          }}
        />
      </button>

      {/* ── Expanded: explanation only ── */}
      {open && (
        <p
          style={{
            margin: "0 0 6px 19px",
            fontSize: 11,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          {risk.explanation}
        </p>
      )}
    </div>
  );
}

interface IntentCardProps {
  intent: Intent | null | undefined;
  isLoading: boolean;
  onRecalculate: () => void;
  recalculating: boolean;
  risks?: Risk[];
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
    flex: 1,
    minHeight: 450,
    boxSizing: "border-box",
    minWidth: 0,
    overflow: "hidden",
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
};

export function IntentCard({
  intent,
  isLoading,
  onRecalculate,
  recalculating,
  risks = [],
}: IntentCardProps) {
  const t = useTranslations("prReview.intent");
  const { repoId, number } = useParams<{ repoId: string; number: string }>();

  if (isLoading) return null;

  if (!intent) {
    return (
      <section
        style={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <SectionLabel icon="Target">Intent</SectionLabel>
        <div style={s.card}>
          <p style={s.emptyTitle}>{t("notRunTitle")}</p>
          <p style={s.emptyBody}>{t("notRunBody")}</p>
          <button
            type="button"
            onClick={onRecalculate}
            disabled={recalculating}
            style={s.recalcBtn}
          >
            {recalculating ? "Running…" : "↻ Run Intent"}
          </button>
        </div>
      </section>
    );
  }

  const hasScope = intent.in_scope.length > 0 || intent.out_of_scope.length > 0;

  return (
    <section
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
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

        {/* Risk Areas from Brief */}
        {risks.length > 0 && (
          <>
            <div style={s.divider} />
            <div>
              <div style={s.riskLabel}>⚠ Risk areas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {risks.map((risk, i) => (
                  <RiskItem
                    key={`${risk.kind}-${i}`}
                    risk={risk}
                    repoId={repoId}
                    prNumber={number}
                  />
                ))}
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
