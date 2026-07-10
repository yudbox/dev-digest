import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, EvalCaseInput } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

const prefillMutate = vi.fn();
vi.mock("@/lib/hooks/evals", () => ({
  usePrefillEvalCase: () => ({ mutate: prefillMutate, isPending: false }),
}));

// Mock at the component boundary (per client/insights/INSIGHTS.md) — the real
// EvalCaseModal pulls in useCreateEvalCase/useUpdateEvalCase/useRunEvalCase,
// which this test file doesn't need to exercise.
vi.mock("@/components/evals/EvalCaseModal", () => ({
  EvalCaseModal: ({ prefill }: { prefill: EvalCaseInput | null }) => (
    <div data-testid="eval-case-modal">{prefill?.name}</div>
  ),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
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
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: messages, eval: evalMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("filters by severity when a pill is clicked", () => {
    const findings: FindingRecord[] = [
      { ...FINDINGS[0]! },
      {
        ...FINDINGS[0]!,
        id: "f2",
        severity: "WARNING",
        title: "Warn finding",
      },
    ];
    renderWithIntl(<FindingsPanel findings={findings} prId="pr1" />);
    // Both visible initially
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
    // Click CRITICAL pill
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Warn finding")).not.toBeInTheDocument();
    // Click again → reset
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
  });

  it("opens EvalCaseModal prefilled from a resolved finding (AC-9)", () => {
    const accepted: FindingRecord = { ...FINDINGS[0]!, accepted_at: "2026-01-01T00:00:00Z" };
    const prefillResult: EvalCaseInput = {
      owner_kind: "agent",
      owner_id: "a1",
      name: "Hardcoded secret",
      input_diff: "",
      input_files: null,
      input_meta: null,
      expected_output: [{ file: "src/config.ts", start_line: 11, end_line: 11 }],
      notes: null,
    };
    prefillMutate.mockImplementation(
      (_id: string, opts: { onSuccess: (v: EvalCaseInput) => void }) =>
        opts.onSuccess(prefillResult),
    );

    renderWithIntl(<FindingsPanel findings={[accepted]} prId="pr1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));

    expect(prefillMutate).toHaveBeenCalledWith("f1", expect.any(Object));
    expect(screen.getByTestId("eval-case-modal")).toHaveTextContent(
      "Hardcoded secret",
    );
  });
});
