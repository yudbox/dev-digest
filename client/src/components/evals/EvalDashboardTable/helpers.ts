/** Pure helpers for EvalDashboardTable — no React, no fetch. */
import type { Agent, EvalDashboard } from "@devdigest/shared";

export interface EvalDashboardRow {
  agent: Agent;
  dashboard: EvalDashboard;
}

/** Joins the workspace-wide `EvalDashboardOverview.agents` list (already
 *  covers every agent, incl. 0-case ones — AC-13/14) with the `Agent` list
 *  (for display fields like `name`/`enabled` that `EvalDashboard` itself
 *  does not carry). Agents missing from the `Agent` list (should not
 *  happen) are dropped defensively. */
export function joinAgentDashboards(
  agents: Agent[],
  dashboards: EvalDashboard[],
): EvalDashboardRow[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const rows: EvalDashboardRow[] = [];
  for (const dashboard of dashboards) {
    const agent = dashboard.owner_id ? byId.get(dashboard.owner_id) : undefined;
    if (agent) rows.push({ agent, dashboard });
  }
  return rows;
}

/** `true` when this agent's dashboard reflects zero eval cases configured. */
export function hasNoCases(dashboard: EvalDashboard): boolean {
  return dashboard.cases_total === 0;
}

/** `true` when cases exist but no batch has ever been run for this owner. */
export function neverRun(dashboard: EvalDashboard): boolean {
  return dashboard.cases_total > 0 && dashboard.trend.length === 0;
}
