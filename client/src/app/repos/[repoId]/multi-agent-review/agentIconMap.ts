/* agentIconMap — keyword→icon mapping for agent tiles (AC-12).
   Pure function, unit-testable. Matches the first keyword in name/description. */
import type { IconName } from "../../../../vendor/ui/icons";

const KEYWORD_MAP: [RegExp, IconName][] = [
  [/security|vuln|owasp|secret|pentest/i, "Shield"],
  [/perf|performance|latency|speed|optim/i, "Zap"],
  [/test|spec|coverage|quality/i, "FlaskConical"],
  [/style|lint|format|convention|clean/i, "Paintbrush"],
  [/arch|design|solid|layer|coupling/i, "Boxes"],
  [/bug|fix|regression/i, "Bug"],
];

export function agentIcon(name: string, description?: string | null): IconName {
  const haystack = `${name} ${description ?? ""}`;
  for (const [re, icon] of KEYWORD_MAP) {
    if (re.test(haystack)) return icon;
  }
  return "Bot";
}

export const AGENT_COLORS = [
  "#ef4444", // red
  "#f59e0b", // yellow
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#10b981", // green
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

/**
 * Deterministic color for an agent based on its ID.
 * Same agent always gets the same color regardless of sort order.
 */
export function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length]!;
}
