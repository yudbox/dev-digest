import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import prReviewMessages from "@messages/en/prReview.json";
import evalMessages from "@messages/en/eval.json";
import type { Line } from "../helpers";
import type { DiffFindingsApi } from "../findings";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useCreatePrComment: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingReplies: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
  usePublishFindingReply: () => ({ mutate: vi.fn(), isPending: false }),
  useEditFindingReply: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteFindingReply: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/evals", () => ({
  usePrefillEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { CodeLine } from "./CodeLine";

afterEach(cleanup);

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ prReview: prReviewMessages, eval: evalMessages }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 2,
    end_line: 2,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

const LINE: Line = { kind: "add", text: "const x = 1;", newNo: 2 };
const API: DiffFindingsApi = { prId: "pr1", byFile: new Map() };

describe("CodeLine — finding markers (AC-18, AC-19)", () => {
  it("renders one marker per finding, stacked, each its own colour; accepted is dimmed", () => {
    const critical = makeFinding({ id: "f1", severity: "CRITICAL" });
    const suggestion = makeFinding({ id: "f2", severity: "SUGGESTION", accepted_at: "2026-01-01T00:00:00Z" });
    renderWithProviders(
      <CodeLine
        ln={LINE}
        path="src/a.ts"
        threads={[]}
        lineFindings={[critical, suggestion]}
        findings={API}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveStyle({ border: "1px solid var(--crit)" });
    expect(buttons[1]).toHaveStyle({ border: "1px solid var(--sugg)" });
    expect(buttons[1]).toHaveStyle({ opacity: "0.45" });
  });

  it("markers render regardless of showComments — only comment threads are gated by it", () => {
    const finding = makeFinding();
    renderWithProviders(
      <CodeLine
        ln={LINE}
        path="src/a.ts"
        threads={[]}
        lineFindings={[finding]}
        findings={API}
        commenting={{
          comments: [],
          canComment: false,
          showComments: false,
          posting: false,
          onSubmit: vi.fn(),
        }}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("CodeLine — marker click opens the card in place (AC-20, AC-21)", () => {
  it("clicking a marker opens exactly one card, with no navigation or request; clicking again closes it", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const f1 = makeFinding({ id: "f1", severity: "CRITICAL" });
    const f2 = makeFinding({ id: "f2", severity: "WARNING" });
    renderWithProviders(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={[f1, f2]} findings={API} />,
    );
    const buttons = screen.getAllByRole("button");

    fireEvent.click(buttons[0]!);
    // Exactly one card open (f1's), identified by its title text.
    expect(screen.getAllByText("A finding")).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Independence: opening f2's card doesn't close f1's.
    fireEvent.click(buttons[1]!);
    expect(screen.getAllByText("A finding")).toHaveLength(2);

    // Toggle: clicking f1's marker again closes only its card.
    fireEvent.click(buttons[0]!);
    expect(screen.getAllByText("A finding")).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

describe("CodeLine — full-width row tint for finding lines", () => {
  function rowOf(text: string) {
    // The styled row is the direct parent of the line-text span.
    return screen.getByText(text).parentElement!;
  }

  it("tints the whole row by the most severe active finding (bar + translucent bg)", () => {
    const warning = makeFinding({ id: "f1", severity: "WARNING" });
    const critical = makeFinding({ id: "f2", severity: "CRITICAL" });
    renderWithProviders(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={[warning, critical]} findings={API} />,
    );
    expect(rowOf("const x = 1;")).toHaveStyle({
      borderLeft: "3px solid var(--crit)",
      background: "var(--crit-bg)",
    });
  });

  it("accepted-only line gets a neutral bar and no severity tint", () => {
    const accepted = makeFinding({ accepted_at: "2026-01-01T00:00:00Z" });
    renderWithProviders(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={[accepted]} findings={API} />,
    );
    const row = rowOf("const x = 1;");
    expect(row).toHaveStyle({ borderLeft: "3px solid var(--border)" });
    expect(row.style.background).not.toContain("-bg");
  });

  it("a line without findings is not tinted", () => {
    renderWithProviders(<CodeLine ln={LINE} path="src/a.ts" threads={[]} />);
    expect(rowOf("const x = 1;").style.borderLeft).toBe("");
  });
});
