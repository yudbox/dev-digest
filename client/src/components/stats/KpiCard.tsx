import React from "react";

/**
 * One KPI tile: small caps label, a large value, and free-form extras (sparkline,
 * ring, badges). The value is whatever the caller passes — never a default zero.
 */
export function KpiCard({
  label,
  value,
  valueTitle,
  aside,
  children,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  /** Tooltip on the value (e.g. why a delta is missing). */
  valueTitle?: string;
  /** Right side of the header row (a ring or a small chart). */
  aside?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        flex: 1,
        minWidth: 0,
        padding: 16,
        borderRadius: 9,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em", textTransform: "uppercase" }}>
          {label}
        </span>
        {aside}
      </div>
      <div title={valueTitle} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="tnum" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}
