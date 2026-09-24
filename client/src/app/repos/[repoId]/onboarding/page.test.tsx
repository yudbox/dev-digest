import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding } from "@devdigest/shared";
import messages from "@messages/en/onboarding.json";

vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid-diagram">{chart}</div>
  ),
}));

// ScrollSpyNav (rendered by the page) uses IntersectionObserver — not
// implemented in jsdom.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver as unknown as typeof IntersectionObserver);

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/contexts", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo-1", full_name: "acme/devdigest", default_branch: "main" },
  }),
}));

const mutate = vi.fn();
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: () => ({ data: ONBOARDING, isLoading: false, isError: false, refetch: vi.fn() }),
  useRegenerateOnboarding: () => ({ mutate, isPending: false }),
}));

const ONBOARDING: Onboarding = {
  repoName: "devdigest",
  filesIndexed: 128,
  generatedAt: new Date().toISOString(),
  headSha: "abc123",
  sections: {
    architecture: {
      overview: "A fullstack monolith.",
      style: "fullstack-monolith",
      nodes: [{ id: "api", label: "API", kind: "package" }],
      edges: [],
    },
    criticalPaths: [
      { file: "server/src/index.ts", whyItMatters: "used by 14 routes", openUrl: "https://x" },
    ],
    howToRun: {
      packageManager: "pnpm",
      commands: ["pnpm install"],
      envVars: [],
      entrypoint: "server/src/index.ts",
    },
    readingPath: [
      { order: 1, file: "server/src/app.ts", reason: "entrypoint", openUrl: "https://x" },
    ],
    firstTasks: [
      {
        title: "Add a missing test",
        suggestedPath: "server/src/lib/foo.test.ts",
        gapType: "missing-test",
        rationale: "no coverage",
        patternPointer: "server/src/lib/bar.test.ts",
        complexity: "Low",
        verificationHint: "pnpm test",
      },
    ],
  },
};

import OnboardingPage from "./page";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("OnboardingPage", () => {
  it("renders exactly 5 collapsible accordion sections (AC-26)", () => {
    renderWithIntl(<OnboardingPage />);
    const headers = document.querySelectorAll('[role="button"]');
    expect(headers).toHaveLength(5);
  });

  it("renders the header with repo name and subtitle (AC-25)", () => {
    renderWithIntl(<OnboardingPage />);
    // Title text is split across nodes (AC-23: repo name is a separately
    // styled blue-monospace span) — match on the heading's textContent.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Onboarding for devdigest",
    );
    expect(screen.getByText(/Generated from index of 128 files/)).toBeInTheDocument();
  });

  it("Regenerate button triggers the regenerate mutation (AC-31)", () => {
    renderWithIntl(<OnboardingPage />);
    fireEvent.click(screen.getByText("Regenerate"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
