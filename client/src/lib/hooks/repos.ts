/* hooks/repos.ts — React Query hooks for repository management. */
"use client";

import React from "react";
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

export interface RepoSyncStatus {
  commits_behind: number | null;
  last_polled_at: string | null;
}

const SYNC_STATUS_CACHE_PREFIX = "devdigest:repo-sync-status:";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readSyncStatusCache(repoId: string): RepoSyncStatus | null {
  try {
    const raw = localStorage.getItem(SYNC_STATUS_CACHE_PREFIX + repoId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { day: string; status: RepoSyncStatus };
    return parsed.day === todayKey() ? parsed.status : null;
  } catch {
    return null; // private mode / SSR / corrupt entry — just re-check from the server.
  }
}

function writeSyncStatusCache(repoId: string, status: RepoSyncStatus): void {
  try {
    localStorage.setItem(
      SYNC_STATUS_CACHE_PREFIX + repoId,
      JSON.stringify({ day: todayKey(), status }),
    );
  } catch {
    // Storage unavailable — the banner just won't persist across reloads today.
  }
}

/**
 * Once-per-day (per repo, per browser) "how stale is the local clone"
 * check for the PR-list header banner. Cached in `localStorage` so opening
 * the same repo's PR list repeatedly in a day doesn't re-fetch from GitHub
 * every time — `GET /repos/:id/sync-status` still runs a real `git fetch`.
 * `forceCheck()` bypasses the cache — call it right after the user clicks
 * the real Refresh button, so the banner can confirm "Up to date" without
 * waiting for the daily cache to expire.
 */
export function useRepoSyncStatus(repoId: string | undefined) {
  const [status, setStatus] = React.useState<RepoSyncStatus | null>(null);
  const [loading, setLoading] = React.useState(false);

  const forceCheck = React.useCallback(async () => {
    if (!repoId) return;
    setLoading(true);
    try {
      const result = await api.get<RepoSyncStatus>(`/repos/${repoId}/sync-status`);
      setStatus(result);
      writeSyncStatusCache(repoId, result);
    } catch {
      // Best-effort — a failed staleness check shouldn't break the PR list page.
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  React.useEffect(() => {
    if (!repoId) return;
    const cached = readSyncStatusCache(repoId);
    if (cached) {
      setStatus(cached);
      return;
    }
    void forceCheck();
    // Only re-run when the repo changes — forceCheck is stable per repoId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  return { status, loading, forceCheck };
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}
