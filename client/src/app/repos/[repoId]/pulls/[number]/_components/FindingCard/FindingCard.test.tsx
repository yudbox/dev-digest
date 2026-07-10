import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

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

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it("disables 'Turn into eval case' until the finding is resolved, then fires it (AC-8/9)", () => {
    const onCreateEvalCase = vi.fn();
    const { rerender } = renderWithIntl(
      <FindingCard
        f={FINDING}
        defaultExpanded
        onAction={() => {}}
        onCreateEvalCase={onCreateEvalCase}
      />,
    );
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).toBeDisabled();

    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ prReview: messages, eval: evalMessages }}
      >
        <FindingCard
          f={accepted}
          defaultExpanded
          onAction={() => {}}
          onCreateEvalCase={onCreateEvalCase}
        />
      </NextIntlClientProvider>,
    );
    const enabledButton = screen.getByText("Turn into eval case").closest("button")!;
    expect(enabledButton).toBeEnabled();
    fireEvent.click(enabledButton);
    expect(onCreateEvalCase).toHaveBeenCalledWith(accepted);
  });
});
