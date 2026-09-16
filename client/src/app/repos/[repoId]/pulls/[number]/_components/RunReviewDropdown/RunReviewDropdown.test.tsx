import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ repoId: "repo1" }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      {
        id: "a1",
        name: "Security",
        model: "gpt-4.1",
        enabled: true,
        avg_duration_ms: 1000,
        avg_cost_usd: 0.01,
      },
    ],
  }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunMultiAgentReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (smoke)", () => {
  it("renders the trigger button", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    // With 1 agent pre-checked, label is "Run <AgentName>"
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
  });
});
