import { AgentPerformanceView } from "./_components/AgentPerformanceView";

/* Route: /agent-performance — workspace-level (no repo scope), like /ci. Thin
   route entry; the view and everything it needs live under _components. */
export default function AgentPerformancePage() {
  return <AgentPerformanceView />;
}
