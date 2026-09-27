import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FirstTask } from "@devdigest/shared";
import messages from "@messages/en/onboarding.json";
import { FirstTasksSection } from "./FirstTasksSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const TASKS: FirstTask[] = [
  {
    title: "Add a test for the retry helper",
    suggestedPath: "server/src/lib/retry.test.ts",
    gapType: "missing-test",
    rationale: "retry.ts has no test coverage and is used by 6 modules",
    patternPointer: "server/src/lib/backoff.test.ts",
    complexity: "Medium",
    verificationHint: "pnpm exec vitest run retry.test.ts",
  },
];

describe("FirstTasksSection", () => {
  it("renders all task fields (AC-32)", () => {
    renderWithIntl(<FirstTasksSection tasks={TASKS} />);
    expect(screen.getByText("Add a test for the retry helper")).toBeInTheDocument();
    expect(screen.getByText("server/src/lib/retry.test.ts")).toBeInTheDocument();
    expect(
      screen.getByText("retry.ts has no test coverage and is used by 6 modules"),
    ).toBeInTheDocument();
    expect(screen.getByText("server/src/lib/backoff.test.ts")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText(/pnpm exec vitest run retry.test.ts/)).toBeInTheDocument();
    expect(screen.getByText("Missing test")).toBeInTheDocument();
  });

  it("renders the card as non-interactive — no onClick/href on the card itself (AC-32)", () => {
    renderWithIntl(<FirstTasksSection tasks={TASKS} />);
    const card = screen.getByTestId("first-task-card");
    expect(card.tagName).toBe("DIV");
    expect(card).not.toHaveAttribute("href");
    expect(card.onclick).toBeNull();
    expect(card).not.toHaveAttribute("role", "button");
  });
});
