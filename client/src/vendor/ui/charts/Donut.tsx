/* Donut — ring chart with a legend, on Recharts. */
import React from "react";
import { PieChart, Pie, Cell, Tooltip } from "recharts";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  /** Extra tooltip text (e.g. the groups folded into an "Other" segment). */
  title?: string;
}

/** Share of the ring a zero segment gets when `minVisible` is on (drawing only). */
const MIN_VISIBLE_SHARE = 0.012;
const EMPTY_RING_COLOR = "var(--bg-hover)";

export function Donut({
  segments,
  size = 130,
  stroke = 22,
  valuePrefix = "$",
  valueFormatter,
  centerLabel,
  emptyText,
  minVisible = false,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  /** Used by the default formatter only (`$` + 2 decimals). */
  valuePrefix?: string;
  /** Overrides the legend/tooltip value text (e.g. "48 · 48%"). */
  valueFormatter?: (segment: DonutSegment) => string;
  /** Rendered in the hole of the ring (e.g. a total). */
  centerLabel?: React.ReactNode;
  /** Shown in the hole instead of `centerLabel` when every value is 0. */
  emptyText?: string;
  /**
   * Draw zero-value segments as a thin sliver of their colour so every legend
   * entry is visible on the ring. Drawing only: the legend and tooltip keep the
   * real value.
   */
  minVisible?: boolean;
}) {
  const format = valueFormatter ?? ((s: DonutSegment) => `${valuePrefix}${s.value.toFixed(2)}`);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const isEmpty = total <= 0;

  // What the ring draws (not what the legend says).
  const sliver = total * MIN_VISIBLE_SHARE;
  const drawn = isEmpty
    ? [{ label: "", value: 1, color: EMPTY_RING_COLOR, real: undefined as DonutSegment | undefined }]
    : segments.map((s) => ({
        label: s.label,
        value: minVisible && s.value === 0 ? sliver : s.value,
        color: s.color,
        real: s as DonutSegment | undefined,
      }));

  const hole = isEmpty ? emptyText : centerLabel;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <PieChart width={size} height={size}>
          <Pie
            data={drawn}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={(size - stroke) / 2 - stroke / 2}
            outerRadius={(size - stroke) / 2 + stroke / 2}
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
            stroke="none"
          >
            {drawn.map((s, i) => (
              <Cell key={i} fill={s.color} />
            ))}
          </Pie>
          {!isEmpty && (
            <Tooltip
              content={({ active, payload }) => {
                const real = active ? (payload?.[0]?.payload as { real?: DonutSegment } | undefined)?.real : undefined;
                if (!real) return null;
                return (
                  <div
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      fontSize: 12,
                      maxWidth: 240,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {real.label}: {format(real)}
                    </div>
                    {real.title && <div style={{ color: "var(--text-muted)", marginTop: 4 }}>{real.title}</div>}
                  </div>
                );
              }}
            />
          )}
        </PieChart>
        {hole != null && (
          <div
            data-testid="donut-center"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              padding: stroke + 8,
              fontSize: isEmpty ? 11 : 16,
              fontWeight: 700,
              color: isEmpty ? "var(--text-muted)" : "var(--text-primary)",
              pointerEvents: "none",
            }}
          >
            {hole}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {segments.map((s, i) => (
          <div
            key={i}
            title={s.title}
            style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
            <span style={{ color: "var(--text-secondary)", flex: 1 }}>{s.label}</span>
            <span className="mono tnum" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {format(s)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
