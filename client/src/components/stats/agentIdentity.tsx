import React from "react";
import { Icon } from "@devdigest/ui";
import { AGENT_PALETTE } from "./constants";

const DELETED_COLOR = "var(--text-muted)";

/** Stable string hash (djb2) → same agent id always lands on the same colour. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic palette colour for an agent id (null = the "Deleted agents" row). */
export function agentColor(id: string | null | undefined): string {
  if (!id) return DELETED_COLOR;
  return AGENT_PALETTE[hash(id) % AGENT_PALETTE.length]!;
}

/** The agent's tile: shared `Cpu` icon in the agent's own colour. */
export function AgentIcon({ id, size = 28 }: { id: string | null | undefined; size?: number }) {
  const color = agentColor(id);
  return (
    <div
      data-testid="agent-icon"
      data-color={color}
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <Icon.Cpu size={Math.round(size * 0.55)} />
    </div>
  );
}
