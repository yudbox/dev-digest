import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import type { EvalBatchRow } from "../RunsTable/helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const promoteMutate = vi.fn();
vi.mock("@/lib/hooks/evals", () => ({
  useAgentVersions: () => ({
    data: [
      { version: 1, system_prompt: "You are a reviewer.\nBe concise.", created_at: "2026-01-01" },
      { version: 2, system_prompt: "You are a strict reviewer.\nBe concise.", created_at: "2026-01-02" },
    ],
  }),
  usePromoteAgentPrompt: () => ({ mutate: promoteMutate, isPending: false }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a strict reviewer.\nBe concise.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 2,
  context_doc_paths: [],
};

const OLDER: EvalBatchRow = {
  batch_id: "b1",
  ran_at: "2026-01-01T00:00:00Z",
  agent_version: 1,
  cases_total: 4,
  traces_passed: 2,
  recall: 0.5,
  precision: 0.6,
  citation_accuracy: 0.7,
  cost_usd: 0.02,
};

const NEWER: EvalBatchRow = {
  batch_id: "b2",
  ran_at: "2026-01-02T00:00:00Z",
  agent_version: 2,
  cases_total: 4,
  traces_passed: 4,
  recall: 0.9,
  precision: 0.8,
  citation_accuracy: 0.7,
  cost_usd: 0.03,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("CompareRunsModal (AC-20/21)", () => {
  it("renders a line-level diff between the two prompt versions and metric deltas", () => {
    renderWithIntl(
      <CompareRunsModal agent={AGENT} batchA={NEWER} batchB={OLDER} onClose={() => {}} />,
    );
    // Diff: "You are a reviewer." (del) -> "You are a strict reviewer." (add)
    expect(screen.getByText("You are a reviewer.")).toBeInTheDocument();
    expect(screen.getByText("You are a strict reviewer.")).toBeInTheDocument();
    // Recall delta old(50%) -> new(90%)
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("disables Promote when the newer selected version is already current, enables + fires it otherwise", () => {
    // Newer batch (v2) === agent.version (2) -> disabled
    renderWithIntl(
      <CompareRunsModal agent={AGENT} batchA={NEWER} batchB={OLDER} onClose={() => {}} />,
    );
    expect(screen.getByText("Promote v2").closest("button")).toBeDisabled();
    cleanup();

    // Agent is still on v1 -> promoting v2 is available
    const agentOnV1 = { ...AGENT, version: 1, system_prompt: "You are a reviewer.\nBe concise." };
    renderWithIntl(
      <CompareRunsModal agent={agentOnV1} batchA={NEWER} batchB={OLDER} onClose={() => {}} />,
    );
    const promoteBtn = screen.getByText("Promote v2").closest("button")!;
    expect(promoteBtn).toBeEnabled();
    fireEvent.click(promoteBtn);
    expect(promoteMutate).toHaveBeenCalledWith("You are a strict reviewer.\nBe concise.");
  });
});
