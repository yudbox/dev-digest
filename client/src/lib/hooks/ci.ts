/* hooks/ci.ts — React Query hooks for CI export, installations, and runs. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  exportCi,
  getCiInstallations,
  getCiRuns,
  refreshCiRuns,
  patchAgentCiFailOn,
  updateCiConfig,
} from "../api";
import type { CiExportInputBody, CiRunsQuery } from "@devdigest/shared";

export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) => exportCi(agentId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
    },
  });
}

export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => getCiInstallations(agentId!),
    enabled: !!agentId,
  });
}

export function useCiRuns(filters?: CiRunsQuery) {
  return useQuery({
    queryKey: ["ci-runs", filters],
    queryFn: () => getCiRuns(filters),
    refetchOnMount: true,
  });
}

export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repo?: string) => refreshCiRuns(repo ? { repo } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

export function usePatchAgentCiFailOn(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ci_fail_on: string) => patchAgentCiFailOn(agentId, ci_fail_on),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useUpdateCiConfig(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => updateCiConfig(agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
    },
  });
}
