/* hooks/evals.ts — React Query hooks for the Eval Pipeline (agent + skill
   eval cases, batch runs, dashboards, agent-version diffing/promote). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchEvalCases,
  fetchEvalCase,
  createEvalCase,
  updateEvalCase,
  deleteEvalCase,
  runEvalCase,
  runAgentEvals,
  runSkillEvals,
  runAllEvalsForWorkspace,
  fetchEvalDashboard,
  fetchEvalDashboardOverview,
  prefillEvalCaseFromFinding,
  promoteAgentPrompt,
  fetchAgentVersions,
} from "@/lib/api";
import type {
  EvalCaseInput,
  EvalOwnerKind,
  AgentVersionSummary,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Eval cases — CRUD
// ---------------------------------------------------------------------------

export function useEvalCases(
  ownerKind: EvalOwnerKind | null | undefined,
  ownerId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["eval-cases", ownerKind, ownerId],
    queryFn: () => fetchEvalCases(ownerKind as EvalOwnerKind, ownerId as string),
    enabled: !!ownerKind && !!ownerId,
  });
}

export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", id],
    queryFn: () => fetchEvalCase(id as string),
    enabled: !!id,
  });
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => createEvalCase(input),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: ["eval-cases", data.owner_kind, data.owner_id],
      });
    },
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  patch: Partial<EvalCaseInput>;
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEvalCaseInput) =>
      updateEvalCase(id, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: ["eval-cases", data.owner_kind, data.owner_id],
      });
      qc.setQueryData(["eval-case", data.id], data);
    },
  });
}

export interface DeleteEvalCaseInput {
  id: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteEvalCaseInput) => deleteEvalCase(id),
    onSuccess: (_data, { id, ownerKind, ownerId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", ownerKind, ownerId] });
      qc.removeQueries({ queryKey: ["eval-case", id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Running cases / batches
// ---------------------------------------------------------------------------

export interface RunEvalCaseInput {
  id: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
}

export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: RunEvalCaseInput) => runEvalCase(id),
    onSuccess: (_data, { ownerKind, ownerId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", ownerKind, ownerId] });
      qc.invalidateQueries({
        queryKey: ["eval-dashboard", ownerKind, ownerId],
      });
      qc.invalidateQueries({ queryKey: ["eval-dashboard-overview"] });
    },
  });
}

export function useRunAgentEvals(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAgentEvals(agentId as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", "agent", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", "agent", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard-overview"] });
    },
  });
}

export function useRunSkillEvals(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runSkillEvals(skillId as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", "skill", skillId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", "skill", skillId] });
    },
  });
}

export function useRunAllEvalsForWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAllEvalsForWorkspace(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-dashboard-overview"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export function useEvalDashboard(
  ownerKind: EvalOwnerKind | null | undefined,
  ownerId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["eval-dashboard", ownerKind, ownerId],
    queryFn: () =>
      fetchEvalDashboard(ownerKind as EvalOwnerKind, ownerId as string),
    enabled: !!ownerKind && !!ownerId,
  });
}

export function useEvalDashboardOverview() {
  return useQuery({
    queryKey: ["eval-dashboard-overview"],
    queryFn: () => fetchEvalDashboardOverview(),
  });
}

// ---------------------------------------------------------------------------
// Finding → eval case prefill
// ---------------------------------------------------------------------------

export function usePrefillEvalCase() {
  return useMutation({
    mutationFn: (findingId: string) => prefillEvalCaseFromFinding(findingId),
  });
}

// ---------------------------------------------------------------------------
// Agent versions + Promote
// ---------------------------------------------------------------------------

export function useAgentVersions(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-versions", agentId],
    queryFn: () => fetchAgentVersions(agentId as string),
    enabled: !!agentId,
  });
}

export function usePromoteAgentPrompt(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (systemPrompt: string) =>
      promoteAgentPrompt(agentId as string, systemPrompt),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
      qc.invalidateQueries({ queryKey: ["agent-versions", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", "agent", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard-overview"] });
    },
  });
}

export type { AgentVersionSummary };
