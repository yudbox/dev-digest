import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CriticalPathItem } from "@devdigest/shared";
import { vcsBlobUrl, type VcsUrlRepo } from "@/lib/utils/vcsUrls";
import messages from "../../../../../../messages/en/onboarding.json";
import { CriticalPathsSection } from "./CriticalPathsSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ITEMS: CriticalPathItem[] = [
  { file: "server/src/index.ts", whyItMatters: "used by 14 routes", openUrl: "https://stale.example/should-not-be-used" },
];

const REPO: VcsUrlRepo = {
  vcs_provider: "github",
  full_name: "acme/devdigest",
  owner: "acme",
  name: "devdigest",
};

describe("CriticalPathsSection", () => {
  it("Open link points to vcsBlobUrl with repo.defaultBranch, opens in a new tab (AC-28)", () => {
    renderWithIntl(
      <CriticalPathsSection items={ITEMS} repo={REPO} defaultBranch="main" />,
    );
    const link = screen.getByText("Open").closest("a")!;
    expect(link).toHaveAttribute(
      "href",
      vcsBlobUrl(REPO, "main", "server/src/index.ts", undefined, undefined, "branch"),
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders the file path and the whyItMatters rationale", () => {
    renderWithIntl(
      <CriticalPathsSection items={ITEMS} repo={REPO} defaultBranch="main" />,
    );
    expect(screen.getByText("server/src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("used by 14 routes")).toBeInTheDocument();
  });
});
