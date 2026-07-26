"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMemory,
  createMemory,
  updateMemory,
  deleteMemory,
  refreshMemory,
} from "@/lib/api";
import type {
  MemoryCreateInput,
  MemoryListQuery,
  MemoryUpdateInput,
} from "@devdigest/shared";

const MEMORY_KEY = ["memory"] as const;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function useMemory(filters?: Partial<MemoryListQuery>) {
  return useQuery({
    queryKey: [...MEMORY_KEY, filters],
    queryFn: () => fetchMemory(filters),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MemoryCreateInput) => createMemory(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MEMORY_KEY });
    },
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<MemoryUpdateInput>;
    }) => updateMemory(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MEMORY_KEY });
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMemory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MEMORY_KEY });
    },
  });
}

/**
 * Refresh reads LOCAL DB only (no GitHub). Triggers runLearning and
 * invalidates the memory query so new auto-learned rows appear.
 */
export function useRefreshMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => refreshMemory(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MEMORY_KEY });
    },
  });
}
