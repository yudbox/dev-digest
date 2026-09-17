/* hooks/repos.ts — React Query hooks for repository management. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Repo, RepoInput } from "../types";

export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<Repo[]>("/repos"),
  });
}

/**
 * TASK-010 (SPEC-2026-08-25-azure-devops-integration, R51) — `RepoInput` now
 * carries `vcs_provider`/`base_url` alongside `url`, needed when the server
 * can't auto-detect the provider from the URL's host (throws
 * `provider_required`) — see AddRepoView's manual provider picker.
 */
export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RepoInput) => api.post<Repo>("/repos", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

export function useRefreshRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<Repo>(`/repos/${repoId}/refresh`),
    onSuccess: (_d, repoId) => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: ["pulls", repoId] });
    },
  });
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}
