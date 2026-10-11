/* StackedBar — one stacked column per bucket (Critical / Warning / Suggestion).
   Built from flex divs on purpose: Recharts' ResponsiveContainer renders at
   zero width in jsdom, which would make the bars untestable. */
import React from "react";

export interface StackedBarDatum {
  /** Short label under the column, e.g. "W1", "H3", "D5". */
  label: string;
  /** Full hover text with the exact range, e.g. "W5: Oct 9 12:22 – now · partial". */
  tooltip: string;
  critical: number;
  warning: number;
  suggestion: number;
}

const SEGMENTS = [
  // Rendered bottom → top.
  { key: "critical", color: "var(--crit)" },
  { key: "warning", color: "var(--warn)" },
  { key: "suggestion", color: "var(--sugg)" },
] as const;

export function StackedBar({
  data,
  height = 120,
  legendLabels = { critical: "Critical", warning: "Warning", suggestion: "Suggestion" },
}: {
  data: StackedBarDatum[];
  height?: number;
  legendLabels?: { critical: string; warning: string; suggestion: string };
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const totals = data.map((d) => d.critical + d.warning + d.suggestion);
  const max = Math.max(1, ...totals);

  return (
    <div>
      <div
        data-testid="stacked-bar-hover"
        style={{ minHeight: 16, fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}
      >
        {hover !== null ? data[hover]?.tooltip : ""}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height, padding: "0 4px" }}>
        {data.map((d, i) => (
          <div
            key={`${d.label}-${i}`}
            data-testid="stacked-bar-column"
            title={d.tooltip}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              gap: 2,
            }}
          >
            {SEGMENTS.map(({ key, color }) => {
              const value = d[key];
              return value > 0 ? (
                <div
                  key={key}
                  data-testid={`stacked-bar-${key}`}
                  style={{ height: `${(value / max) * 100}%`, background: color, borderRadius: 2 }}
                />
              ) : null;
            })}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, padding: "4px 4px 0" }}>
        {data.map((d, i) => (
          <span
            key={`${d.label}-${i}`}
            style={{ flex: 1, fontSize: 9.5, color: "var(--text-muted)", textAlign: "center" }}
          >
            {d.label}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11 }}>
        {(["critical", "warning", "suggestion"] as const).map((key) => (
          <span
            key={key}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-secondary)" }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: SEGMENTS.find((s) => s.key === key)!.color,
              }}
            />
            {legendLabels[key]}
          </span>
        ))}
      </div>
    </div>
  );
}
