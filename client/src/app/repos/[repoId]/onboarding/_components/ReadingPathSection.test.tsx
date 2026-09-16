import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReadingPathItem } from "@devdigest/shared";
import { vcsBlobUrl, type VcsUrlRepo } from "@/lib/utils/vcsUrls";
import messages from "../../../../../../messages/en/onboarding.json";
import { ReadingPathSection } from "./ReadingPathSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ITEMS: ReadingPathItem[] = [
  { order: 1, file: "server/src/app.ts", reason: "entrypoint", openUrl: "https://stale.example/unused" },
  { order: 2, file: "server/src/modules/index.ts", reason: "module registry", openUrl: "https://stale.example/unused" },
];

const REPO: VcsUrlRepo = {
  vcs_provider: "github",
  full_name: "acme/devdigest",
  owner: "acme",
  name: "devdigest",
};

describe("ReadingPathSection", () => {
  it("Open link points to vcsBlobUrl with repo.defaultBranch, opens in a new tab (AC-28)", () => {
    renderWithIntl(
      <ReadingPathSection items={ITEMS} repo={REPO} defaultBranch="main" />,
    );
    const links = screen.getAllByText("Open").map((el) => el.closest("a")!);
    expect(links[0]).toHaveAttribute(
      "href",
      vcsBlobUrl(REPO, "main", "server/src/app.ts", undefined, undefined, "branch"),
    );
    expect(links[0]).toHaveAttribute("target", "_blank");
  });

  it("renders items in order with their reason", () => {
    renderWithIntl(
      <ReadingPathSection items={ITEMS} repo={REPO} defaultBranch="main" />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("entrypoint")).toBeInTheDocument();
    expect(screen.getByText("module registry")).toBeInTheDocument();
  });
});
