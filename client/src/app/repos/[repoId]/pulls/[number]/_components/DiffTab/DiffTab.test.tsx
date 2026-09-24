import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, SmartDiff, PrFile } from "@devdigest/shared";
import shellMessages from "@messages/en/shell.json";
import prReviewMessages from "@messages/en/prReview.json";
import evalMessages from "@messages/en/eval.json";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { fetchSmartDiffMock, apiGetMock, apiPostMock } = vi.hoisted(() => ({
  fetchSmartDiffMock: vi.fn(),
  apiGetMock: vi.fn().mockResolvedValue([]),
  apiPostMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { get: apiGetMock, post: apiPostMock },
  fetchSmartDiff: fetchSmartDiffMock,
  API_BASE: "http://localhost:3001",
}));

vi.mock("@/lib/hooks/evals", () => ({
  usePrefillEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FINDING_TITLE = "Hardcoded secret";
const SIBLING_TITLE = "Weak crypto";

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: FINDING_TITLE,
    file: "src/a.ts",
    start_line: 2,
    end_line: 2,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

const FILES: PrFile[] = [
  {
    path: "src/a.ts",
    additions: 1,
    deletions: 0,
    patch: ["@@ -1,3 +1,3 @@", " context line 1", "+added line 2", " context line 3"].join("\n"),
  },
];

function smartDiffWith(lineFindings: FindingRecord[] | null): SmartDiff {
  return {
    groups: [
      {
        role: "core",
        files: [
          {
            path: "src/a.ts",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            line_findings: lineFindings,
          },
        ],
      },
    ],
    split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
    review_tokens: 100,
  };
}

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ shell: shellMessages, prReview: prReviewMessages, eval: evalMessages }}
      >
        <DiffTab
          prId="pr1"
          filesCount={FILES.length}
          files={FILES}
          smartOrder={false}
          onSmartOrderChange={vi.fn()}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe("DiffTab — single data source (AC-12, AC-31, AC-32, AC-33, AC-34)", () => {
  it("renders in Original order by default, even once smart-diff has loaded", async () => {
    fetchSmartDiffMock.mockResolvedValue(smartDiffWith([]));
    renderTab({ smartOrder: false });
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    // The Smart/Original toggle appears once smart-diff loads — "Original
    // order" must be the highlighted (active) one, never "Core logic" chrome.
    await screen.findByText("Original order");
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
  });

  it("line_findings: null renders the diff with no markers and no console errors (AC-33)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSmartDiffMock.mockResolvedValue(smartDiffWith(null));
    renderTab({ smartOrder: false });
    // Wait for smart-diff to actually resolve (proven by the toggle appearing).
    await screen.findByText("Original order");
    expect(screen.queryAllByTitle(FINDING_TITLE)).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("smart-diff pending → renders Original order with no markers, doesn't block code (AC-34)", async () => {
    fetchSmartDiffMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderTab({ smartOrder: true });
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.queryByText("Original order")).not.toBeInTheDocument();
    expect(screen.queryAllByTitle(FINDING_TITLE)).toHaveLength(0);
  });

  it("Original order is the plain diff — finding markers only appear in Smart order", async () => {
    fetchSmartDiffMock.mockResolvedValue(smartDiffWith([makeFinding()]));

    const { rerender, qc } = renderTab({ smartOrder: false });
    await screen.findByText("src/a.ts");
    // Wait until smart-diff has resolved (toggle visible) before asserting absence.
    await screen.findByText("Original order");
    expect(screen.queryAllByTitle(FINDING_TITLE)).toHaveLength(0);

    rerender(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider
          locale="en"
          messages={{ shell: shellMessages, prReview: prReviewMessages, eval: evalMessages }}
        >
          <DiffTab
            prId="pr1"
            filesCount={FILES.length}
            files={FILES}
            smartOrder={true}
            onSmartOrderChange={vi.fn()}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findAllByTitle(FINDING_TITLE)).toHaveLength(1);
  });
});

describe("DiffTab — one Show/Hide switch for comments and findings", () => {
  it("offers the switch when there are findings but no GitHub comments, and it hides/shows the markers", async () => {
    fetchSmartDiffMock.mockResolvedValue(smartDiffWith([makeFinding()]));
    renderTab({ smartOrder: true });
    expect(await screen.findByTitle(FINDING_TITLE)).toBeInTheDocument();

    fireEvent.click(await screen.findByText(/Hide findings \(1\)/));
    await waitFor(() => expect(screen.queryByTitle(FINDING_TITLE)).not.toBeInTheDocument());
    expect(screen.getByTestId("file-dot")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Show findings \(1\)/));
    expect(await screen.findByTitle(FINDING_TITLE)).toBeInTheDocument();
  });

  it("does not offer the switch in Original order when there are no comments (findings aren't shown there)", async () => {
    fetchSmartDiffMock.mockResolvedValue(smartDiffWith([makeFinding()]));
    renderTab({ smartOrder: false });
    await screen.findByText("Original order");
    expect(screen.queryByText(/findings \(/)).not.toBeInTheDocument();
  });
});

describe("DiffTab — finding action refetches smart-diff (AC-23, AC-24, AC-25, AC-26)", () => {
  it("accepting a finding dims its marker after the smart-diff refetch", async () => {
    const active = makeFinding();
    const accepted = { ...active, accepted_at: "2026-01-01T00:00:00Z" };
    fetchSmartDiffMock
      .mockResolvedValueOnce(smartDiffWith([active]))
      .mockResolvedValueOnce(smartDiffWith([accepted]));
    apiPostMock.mockResolvedValue({ finding: accepted });

    renderTab({ smartOrder: true });
    const marker = await screen.findByTitle(FINDING_TITLE);
    expect(marker).toHaveStyle({ opacity: "1" });
    fireEvent.click(marker); // open the card
    fireEvent.click(await screen.findByText("Accept"));

    await waitFor(() => expect(fetchSmartDiffMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTitle(FINDING_TITLE)).toHaveStyle({ opacity: "0.45" }),
    );
  });

  it("dismissing a finding removes its marker while a sibling finding's marker stays", async () => {
    const f1 = makeFinding({ id: "f1" });
    const f2 = makeFinding({ id: "f2", severity: "WARNING", title: SIBLING_TITLE });
    fetchSmartDiffMock
      .mockResolvedValueOnce(smartDiffWith([f1, f2]))
      .mockResolvedValueOnce(smartDiffWith([f2]));
    apiPostMock.mockResolvedValue({ finding: { ...f1, dismissed_at: "2026-01-01T00:00:00Z" } });

    renderTab({ smartOrder: true });
    const marker = await screen.findByTitle(FINDING_TITLE);
    expect(screen.getByTitle(SIBLING_TITLE)).toBeInTheDocument();
    fireEvent.click(marker); // open f1's card
    fireEvent.click(await screen.findByText("Dismiss"));

    await waitFor(() => expect(fetchSmartDiffMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTitle(FINDING_TITLE)).not.toBeInTheDocument());
    expect(screen.getByTitle(SIBLING_TITLE)).toBeInTheDocument();
  });

  it("undoing an accept makes the finding active again", async () => {
    const accepted = makeFinding({ accepted_at: "2026-01-01T00:00:00Z" });
    const active = { ...accepted, accepted_at: null };
    fetchSmartDiffMock
      .mockResolvedValueOnce(smartDiffWith([accepted]))
      .mockResolvedValueOnce(smartDiffWith([active]));
    apiPostMock.mockResolvedValue({ finding: active });

    renderTab({ smartOrder: true });
    const marker = await screen.findByTitle(FINDING_TITLE);
    expect(marker).toHaveStyle({ opacity: "0.45" });
    fireEvent.click(marker);
    fireEvent.click(await screen.findByTitle("Undo"));

    await waitFor(() => expect(fetchSmartDiffMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTitle(FINDING_TITLE)).toHaveStyle({ opacity: "1" }),
    );
  });
});
