/* agentIconMap — keyword→icon mapping for agent tiles (AC-12).
   Pure function, unit-testable. Matches the first keyword in name/description. */
import type { IconName } from "../../vendor/ui/icons";

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
