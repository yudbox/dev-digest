/* hooks/pulls.ts — React Query hooks for pull requests. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fetchSmartDiff } from "../api";
import type { PrMeta, PrDetail } from "../types";
import type { Intent, SmartDiff } from "@devdigest/shared";

export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
    // Auto-refresh PR statuses: re-sync from GitHub every 60s while the page is
    // open, and whenever the window regains focus.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullDetail(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["pull", prId],
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: prId != null,
  });
}

export function usePullIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<Intent>(`/pulls/${prId}/intent`),
    enabled: prId != null,
    staleTime: 5 * 60 * 1000,
    retry: (count, err: unknown) =>
      (err as { status?: number })?.status === 404 ? false : count < 2,
  });
}

export function useRecalculateIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Intent>(`/pulls/${prId}/intent/recalculate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intent", prId] }),
  });
}

export function useSmartDiff(prId: string | null | undefined) {
  return useQuery<SmartDiff>({
    queryKey: ["smart-diff", prId],
    queryFn: () => fetchSmartDiff(prId!),
    enabled: !!prId,
    staleTime: 30_000,
  });
}
