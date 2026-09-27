import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, SmartDiff, PrFile } from "@devdigest/shared";
import messages from "@messages/en/prReview.json";

vi.mock("@/components/diff-viewer/FileCard", () => ({
  FileCard: ({
    file,
    initialOpen,
  }: {
    file: { path: string };
    initialOpen?: boolean;
  }) => (
    <div data-testid={`file-${file.path}`} data-open={String(!!initialOpen)}>
      {file.path}
    </div>
  ),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
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

function makeFile(path: string): PrFile {
  return { path, additions: 1, deletions: 0, patch: null };
}

describe("SmartDiffViewer", () => {
  it("shows all 5 groups, each with its own localised label (AC-13)", () => {
    const smartDiff: SmartDiff = {
      groups: [
        { role: "core", files: [{ path: "a.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
        { role: "tests", files: [{ path: "a.test.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
        { role: "wiring", files: [{ path: "index.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
        { role: "docs", files: [{ path: "README.md", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
        { role: "boilerplate", files: [{ path: "dist/x.js", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
      ],
      split_suggestion: { too_big: false, total_lines: 5, proposed_splits: [] },
      review_tokens: null,
    };
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={smartDiff}
        files={["a.ts", "a.test.ts", "index.ts", "README.md", "dist/x.js"].map(makeFile)}
      />,
    );
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });

  it("counts files with an active finding per group (AC-14) — accepted-only doesn't count, 0 hides the counter", () => {
    const smartDiff: SmartDiff = {
      groups: [
        {
          role: "core",
          files: [
            { path: "a.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [makeFinding({ id: "f1" })] },
            { path: "b.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [makeFinding({ id: "f2" })] },
            {
              path: "c.ts",
              pseudocode_summary: null,
              additions: 1,
              deletions: 0,
              line_findings: [makeFinding({ id: "f3", accepted_at: "2026-01-01T00:00:00Z" })],
            },
          ],
        },
        {
          role: "wiring",
          files: [{ path: "index.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
      review_tokens: null,
    };
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={smartDiff}
        files={["a.ts", "b.ts", "c.ts", "index.ts"].map(makeFile)}
      />,
    );
    // core: 2 files with an active finding (c.ts is accepted-only → not counted)
    expect(screen.getByText("● 2")).toBeInTheDocument();
    // wiring has 0 files with findings → no counter rendered
    expect(screen.queryByText("● 0")).not.toBeInTheDocument();
    expect(screen.queryAllByText(/^● /)).toHaveLength(1);
  });

  it("collapses docs/boilerplate by default, expands a file with a finding (incl. accepted-only) or the deep-link target (AC-15)", () => {
    const smartDiff: SmartDiff = {
      groups: [
        {
          role: "docs",
          files: [
            { path: "docs/a.md", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] },
            {
              path: "docs/b.md",
              pseudocode_summary: null,
              additions: 1,
              deletions: 0,
              line_findings: [makeFinding({ id: "f1", accepted_at: "2026-01-01T00:00:00Z" })],
            },
            { path: "docs/c.md", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] },
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 3, proposed_splits: [] },
      review_tokens: null,
    };
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={smartDiff}
        files={["docs/a.md", "docs/b.md", "docs/c.md"].map(makeFile)}
        targetFile="docs/c.md"
      />,
    );
    expect(screen.getByTestId("file-docs/a.md")).toHaveAttribute("data-open", "false");
    // accepted-only finding still expands the file (AC-15)
    expect(screen.getByTestId("file-docs/b.md")).toHaveAttribute("data-open", "true");
    // deep-link target expands regardless of findings
    expect(screen.getByTestId("file-docs/c.md")).toHaveAttribute("data-open", "true");
  });

  it("expands core/tests/wiring files by default (AC-16)", () => {
    const smartDiff: SmartDiff = {
      groups: [
        { role: "core", files: [{ path: "a.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
        { role: "tests", files: [{ path: "a.test.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
        { role: "wiring", files: [{ path: "index.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: null }] },
      ],
      split_suggestion: { too_big: false, total_lines: 3, proposed_splits: [] },
      review_tokens: null,
    };
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={smartDiff}
        files={["a.ts", "a.test.ts", "index.ts"].map(makeFile)}
      />,
    );
    expect(screen.getByTestId("file-a.ts")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("file-a.test.ts")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("file-index.ts")).toHaveAttribute("data-open", "true");
  });
});

describe("SmartDiffViewer — group accordions and five fixed groups", () => {
  const FIVE_GROUPS = (coreFiles: string[]): SmartDiff => ({
    groups: [
      {
        role: "core",
        files: coreFiles.map((path) => ({
          path,
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          line_findings: [makeFinding({ file: path })],
        })),
      },
      { role: "tests", files: [] },
      { role: "wiring", files: [] },
      { role: "docs", files: [] },
      { role: "boilerplate", files: [] },
    ],
    split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
    review_tokens: null,
  });

  it("renders all five groups in order; empty ones show their label and 0 files", () => {
    renderWithIntl(
      <SmartDiffViewer smartDiff={FIVE_GROUPS(["src/a.ts"])} files={[makeFile("src/a.ts")]} />,
    );
    const roles = screen.getAllByTestId(/^group-/).map((el) => el.dataset.testid);
    expect(roles).toEqual(["group-core", "group-tests", "group-wiring", "group-docs", "group-boilerplate"]);
    const tests = screen.getByTestId("group-tests");
    expect(within(tests).getByText("0 files")).toBeInTheDocument();
    expect(within(tests).getByRole("button")).toHaveAttribute("aria-disabled", "true");
  });

  it("shows '● N' (files with findings) right before 'N files' in the group header", () => {
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={FIVE_GROUPS(["src/a.ts", "src/b.ts"])}
        files={[makeFile("src/a.ts"), makeFile("src/b.ts")]}
      />,
    );
    const header = within(screen.getByTestId("group-core")).getByRole("button");
    const counter = within(header).getByText("● 2");
    const files = within(header).getByText("2 files");
    // Both live in the same right-aligned cluster, counter first.
    expect(counter.parentElement).toBe(files.parentElement);
    expect(counter.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking a group header collapses and re-expands its files", () => {
    renderWithIntl(
      <SmartDiffViewer smartDiff={FIVE_GROUPS(["src/a.ts"])} files={[makeFile("src/a.ts")]} />,
    );
    const header = within(screen.getByTestId("group-core")).getByRole("button");
    expect(screen.getByTestId("file-src/a.ts")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(header);
    expect(screen.queryByTestId("file-src/a.ts")).not.toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header);
    expect(screen.getByTestId("file-src/a.ts")).toBeInTheDocument();
  });
});

describe("SmartDiffViewer — sticky group header", () => {
  it("group header sticks to the top, right under the sticky PR header", () => {
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={{
          groups: [{ role: "core", files: [] }],
          split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
          review_tokens: null,
        }}
        files={[]}
      />,
    );
    const header = within(screen.getByTestId("group-core")).getByRole("button");
    expect(header).toHaveStyle({ position: "sticky", zIndex: "4" });
    expect(header.style.top).toBe("var(--pr-header-h, 0px)");
    expect(header.style.background).toBe("var(--bg-primary)");
  });
});

describe("SmartDiffViewer — 'review not run yet' empty state", () => {
  const withFindings = (lineFindings: FindingRecord[] | null): SmartDiff => ({
    groups: [
      {
        role: "core",
        files: [
          { path: "src/a.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: lineFindings },
        ],
      },
      { role: "tests", files: [] },
    ],
    split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
    review_tokens: null,
  });

  it("shows the empty state when no review has run (line_findings null) — no zero counters", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={withFindings(null)} files={[makeFile("src/a.ts")]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Review hasn't been run yet");
    expect(screen.queryByText(/^● /)).not.toBeInTheDocument();
    // Grouping still works without a review.
    expect(screen.getByTestId("file-src/a.ts")).toBeInTheDocument();
  });

  it("does not show it once a review ran, even with no findings (line_findings [])", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={withFindings([])} files={[makeFile("src/a.ts")]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
