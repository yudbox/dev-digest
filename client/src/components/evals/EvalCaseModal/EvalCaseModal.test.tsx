import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalCase } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import commonMessages from "../../../../messages/en/common.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

afterEach(cleanup);

const POSITIVE_CASE: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "",
  input_files: null,
  input_meta: null,
  expected_output: [{ file: "src/config.ts", start_line: 1, end_line: 2 }],
  notes: null,
};

const NEGATIVE_CASE: EvalCase = {
  ...POSITIVE_CASE,
  id: "c2",
  expected_output: [],
};

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ eval: evalMessages, common: commonMessages }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("EvalCaseModal (AC-10)", () => {
  it("shows the POSITIVE banner when expected_output is non-empty", () => {
    renderWithProviders(
      <EvalCaseModal initial={POSITIVE_CASE} onClose={() => {}} />,
    );
    expect(screen.getByText(/POSITIVE CASE/)).toBeInTheDocument();
  });

  it("shows the NEGATIVE banner when expected_output is empty", () => {
    renderWithProviders(
      <EvalCaseModal initial={NEGATIVE_CASE} onClose={() => {}} />,
    );
    expect(screen.getByText(/NEGATIVE CASE/)).toBeInTheDocument();
  });
});
