/* Sparkline — lightweight inline-SVG trend line (no Recharts; trivial + perf). */
import React from "react";

export function Sparkline({
  data,
  color = "var(--accent)",
  w = 80,
  h = 24,
  pointTitles,
}: {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
  /** Optional hover text per point (same length as `data`), e.g. bucket ranges. */
  pointTitles?: string[];
}) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  // A single point has no horizontal extent: centre it instead of dividing by 0.
  const x = (i: number) => (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const pts = data.map((v, i) => [x(i), h - ((v - min) / span) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0]!.toFixed(1) + "," + p[1]!.toFixed(1)).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
      {pointTitles &&
        pts.map((p, i) => (
          <circle key={i} data-testid="sparkline-point" cx={p[0]} cy={p[1]} r={5} fill="transparent">
            <title>{pointTitles[i]}</title>
          </circle>
        ))}
    </svg>
  );
}
