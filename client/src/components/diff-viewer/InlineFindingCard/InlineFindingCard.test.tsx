import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, EvalCaseInput } from "@devdigest/shared";
import prReviewMessages from "@messages/en/prReview.json";
import evalMessages from "@messages/en/eval.json";
import type { DiffFindingsApi } from "../findings";

const { actionMutate, prefillMutate, notifyError, pendingState } = vi.hoisted(() => ({
  actionMutate: vi.fn(),
  prefillMutate: vi.fn(),
  notifyError: vi.fn(),
  pendingState: { flag: false, vars: undefined as { findingId: string } | undefined },
}));

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({
    mutate: actionMutate,
    isPending: pendingState.flag,
    variables: pendingState.vars,
  }),
  useCreatePrComment: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingReplies: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
  usePublishFindingReply: () => ({ mutate: vi.fn(), isPending: false }),
  useEditFindingReply: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteFindingReply: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  usePrefillEvalCase: () => ({ mutate: prefillMutate, isPending: false }),
}));

vi.mock("@/components/evals/EvalCaseModal", () => ({
  EvalCaseModal: ({ prefill }: { prefill: EvalCaseInput | null }) => (
    <div data-testid="eval-case-modal">{prefill?.name}</div>
  ),
}));

vi.mock("@/lib/contexts/toast", () => ({
  notify: { error: notifyError, success: vi.fn(), info: vi.fn() },
}));

import { InlineFindingCard } from "./InlineFindingCard";

afterEach(() => {
  cleanup();
  pendingState.flag = false;
  pendingState.vars = undefined;
  vi.clearAllMocks();
});

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ prReview: prReviewMessages, eval: evalMessages }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const API: DiffFindingsApi = { prId: "pr1", byFile: new Map() };

describe("InlineFindingCard (AC-22, AC-27, AC-28)", () => {
  it("renders the full FindingCard with every Findings-tab action, and opens EvalCaseModal from 'Turn into eval case'", () => {
    prefillMutate.mockImplementation((_id, opts: { onSuccess: (v: EvalCaseInput) => void }) =>
      opts.onSuccess({
        owner_kind: "agent",
        owner_id: "a1",
        name: "Hardcoded secret",
        input_diff: "",
        input_files: null,
        input_meta: null,
        expected_output: [],
        notes: null,
      }),
    );
    const accepted = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    renderWithProviders(<InlineFindingCard f={accepted} api={API} />);

    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    expect(screen.getByText("Learn")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(screen.getByTestId("eval-case-modal")).toHaveTextContent("Hardcoded secret");
  });

  it("shows an error toast and keeps state unchanged when an action fails (AC-27)", () => {
    actionMutate.mockImplementation((_vars, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new Error("500"));
    });
    renderWithProviders(<InlineFindingCard f={FINDING} api={API} />);

    fireEvent.click(screen.getByText("Accept"));
    expect(notifyError).toHaveBeenCalled();
    // Still shows the un-accepted state (no accepted tag).
    expect(screen.queryByText("accepted")).not.toBeInTheDocument();
  });

  it("disables the action buttons while a request for this finding is pending (AC-28)", () => {
    pendingState.flag = true;
    pendingState.vars = { findingId: FINDING.id };
    renderWithProviders(<InlineFindingCard f={FINDING} api={API} />);

    expect(screen.getByText("Accept").closest("button")).toBeDisabled();
    expect(screen.getByText("Dismiss").closest("button")).toBeDisabled();
  });
});
