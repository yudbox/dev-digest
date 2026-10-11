/* hooks/performance.ts — React Query hooks for the stats screens (Agent
   Performance, Agent Stats, run history). Every hook reads the GLOBAL period
   from usePeriod(): the period is part of the query key, so changing it is a
   new GET (read-only) with its own cache entry, and nothing fires until the
   stored period has been read (`ready`). Only the explicit Sync CI mutation
   writes anything. */
"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAgentPerformance,
  getAgentRuns,
  getAgentStats,
  getRunFindings,
  getSkillStats,
  refreshCiRuns,
} from "../api";
import { usePeriod } from "../contexts/periodContext";

/** Rows loaded per page of the run history; the next page loads near the end. */
export const RUN_HISTORY_PAGE_SIZE = 10;

export function useAgentPerformance() {
  const { query, ready } = usePeriod();
  return useQuery({
    queryKey: ["agent-performance", query],
    queryFn: () => getAgentPerformance(query),
    enabled: ready,
    retry: false,
  });
}

export function useAgentStats(agentId: string | null | undefined) {
  const { query, ready } = usePeriod();
  return useQuery({
    queryKey: ["agent-stats", agentId, query],
    queryFn: () => getAgentStats(agentId!, query),
    enabled: ready && !!agentId,
    retry: false,
  });
}

/** Cursor-paged run history (newest first); `fetchNextPage` loads the next 10. */
export function useAgentRuns(agentId: string | null | undefined) {
  const { query, ready } = usePeriod();
  return useInfiniteQuery({
    queryKey: ["agent-runs", agentId, query],
    queryFn: ({ pageParam }) =>
      getAgentRuns(agentId!, query, { cursor: pageParam, limit: RUN_HISTORY_PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: ready && !!agentId,
    retry: false,
  });
}

/** One skill's numbers for the global period. */
export function useSkillStats(skillId: string | null | undefined) {
  const { query, ready } = usePeriod();
  return useQuery({
    queryKey: ["skill-stats", skillId, query],
    queryFn: () => getSkillStats(skillId!, query),
    enabled: ready && !!skillId,
    retry: false,
  });
}

/** Findings of one run for the trace drawer — fetched only once the drawer opens. */
export function useRunFindings(runId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["run-findings", runId],
    queryFn: () => getRunFindings(runId!),
    enabled: !!runId && enabled,
    retry: false,
  });
}

/**
 * "Sync CI": the existing CI import (GitHub API, no model call), then refresh
 * every stats query on screen. The global MutationCache already toasts an error,
 * so callers must not toast failures again; the previously shown data stays.
 */
export function useSyncCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => refreshCiRuns(),
    onSuccess: () => {
      for (const key of ["agent-performance", "agent-stats", "agent-runs", "skill-stats", "ci-runs"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
