import type { WorkflowRun } from "@devdigest/shared";

/**
 * When a CI run actually ran: GitHub's own start time, else its creation time.
 * Only when GitHub reports neither (it always does for real runs) the caller's
 * `now` is used, so a run is never filed under "the day we happened to import it".
 */
export function ciRunTime(run: Pick<WorkflowRun, "runStartedAt" | "createdAt">, now: Date): Date {
  for (const candidate of [run.runStartedAt, run.createdAt]) {
    if (!candidate) continue;
    const t = new Date(candidate);
    if (!Number.isNaN(t.getTime())) return t;
  }
  return now;
}
