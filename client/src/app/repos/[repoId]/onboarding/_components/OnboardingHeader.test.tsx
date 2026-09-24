import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import messages from "@messages/en/onboarding.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));

import { OnboardingHeader } from "./OnboardingHeader";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ONBOARDING: Onboarding = {
  repoName: "devdigest",
  filesIndexed: 128,
  generatedAt: new Date().toISOString(),
  headSha: "abc123",
  sections: {
    architecture: { overview: "", style: "fullstack-monolith", nodes: [], edges: [] },
    criticalPaths: [],
    howToRun: { packageManager: "pnpm", commands: [], envVars: [], entrypoint: "" },
    readingPath: [],
    firstTasks: [],
  },
};

describe("OnboardingHeader", () => {
  it("shows repo name, subtitle, and both action buttons (AC-25)", () => {
    renderWithIntl(
      <OnboardingHeader onboarding={ONBOARDING} onRegenerate={vi.fn()} isRegenerating={false} />,
    );
    // Title text is split across nodes now (AC-23: repo name is a separately
    // styled blue-monospace span, not plain text) — match on the heading's
    // full textContent instead of a single getByText string.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Onboarding for devdigest");
    const repoNameSpan = screen.getByText("devdigest");
    expect(repoNameSpan.tagName).toBe("SPAN");
    expect(repoNameSpan).toHaveStyle({ fontFamily: "monospace" });
    expect(screen.getByText(/Generated from index of 128 files/)).toBeInTheDocument();
    expect(screen.getByText("Regenerate")).toBeInTheDocument();
    expect(screen.getByText("Share link")).toBeInTheDocument();
  });

  it("calls onRegenerate when Regenerate is clicked (AC-31)", () => {
    const onRegenerate = vi.fn();
    renderWithIntl(
      <OnboardingHeader onboarding={ONBOARDING} onRegenerate={onRegenerate} isRegenerating={false} />,
    );
    fireEvent.click(screen.getByText("Regenerate"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("copies the full absolute onboarding URL (origin + canonical path, not a bare path) on Share link click (AC-31)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithIntl(
      <OnboardingHeader onboarding={ONBOARDING} onRegenerate={vi.fn()} isRegenerating={false} />,
    );
    fireEvent.click(screen.getByText("Share link"));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/repos/repo-1/onboarding`,
    );
    expect(await screen.findByText("Link copied!")).toBeInTheDocument();
  });

  it("shows the narrativeUnavailable banner when the LLM call failed", () => {
    renderWithIntl(
      <OnboardingHeader
        onboarding={{ ...ONBOARDING, narrativeUnavailable: true }}
        onRegenerate={vi.fn()}
        isRegenerating={false}
      />,
    );
    expect(screen.getByText(/AI-narrative unavailable|LLM call failed/i)).toBeInTheDocument();
  });
});
