import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCase, EvalDashboard } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";

const CASES: EvalCase[] = [
  {
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "src/config.ts", start_line: 1, end_line: 2 }],
    notes: null,
  },
];

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 1,
  current: {
    recall: 0.9,
    precision: 0.8,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 1,
    cost_usd: 0.01,
  },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  recent_runs: [
    {
      id: "r1",
      case_id: "c1",
      case_name: "stripe-key-leak",
      ran_at: "2026-01-01T00:00:00Z",
      actual_output: { with: { recall: 1 }, without: { recall: 0 } },
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 100,
      cost_usd: 0.01,
      batch_id: "b1",
      agent_version: 1,
    },
  ],
  alert: null,
};

const deleteMutate = vi.fn();
const runMutate = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: CASES, isLoading: false }),
  useEvalDashboard: () => ({ data: DASHBOARD }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate, isPending: false }),
  useRunEvalCase: () => ({ mutate: runMutate, isPending: false }),
  useRunAgentEvals: () => ({ mutate: vi.fn(), isPending: false }),
  useRunSkillEvals: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/evals/EvalCaseModal/EvalCaseModal", () => ({
  EvalCaseModal: () => <div data-testid="eval-case-modal" />,
}));

import { EvalsTab } from "./EvalsTab";

afterEach(cleanup);

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("EvalsTab (AC-21/23/28)", () => {
  it("agent owner: shows metric tiles, case list, and a 'view full dashboard' link", () => {
    renderWithProviders(<EvalsTab ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("View full dashboard →")).toBeInTheDocument();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
  });

  it("skill owner: hides the dashboard link and shows with/without numbers per case, no trend/Compare/Promote", () => {
    renderWithProviders(<EvalsTab ownerKind="skill" ownerId="sk1" />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.queryByText("View full dashboard →")).not.toBeInTheDocument();
    expect(screen.queryByText(/promote/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/compare/i)).not.toBeInTheDocument();
    expect(screen.getByText(/With skill/)).toBeInTheDocument();
    expect(screen.getByText(/Without skill/)).toBeInTheDocument();
  });
});
