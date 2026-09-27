import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import shellMessages from "@messages/en/shell.json";
import prReviewMessages from "@messages/en/prReview.json";
import { FileCard } from "./FileCard";
import type { DiffFindingsApi } from "../findings";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ shell: shellMessages, prReview: prReviewMessages }}
    >
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

const FILE: PrFile = {
  path: "src/a.ts",
  additions: 1,
  deletions: 0,
  patch: ["@@ -1,3 +1,3 @@", " context line 1", "+added line 2", " context line 3"].join("\n"),
};

function makeApi(findings: FindingRecord[]): DiffFindingsApi {
  return {
    prId: "pr1",
    byFile: new Map([["src/a.ts", findings]]),
  };
}

describe("FileCard — file dot (AC-17)", () => {
  it("no dot when there are no findings", () => {
    renderWithIntl(<FileCard file={FILE} findings={makeApi([])} initialOpen />);
    expect(screen.queryByTestId("file-dot")).not.toBeInTheDocument();
  });

  it("shows a dot for a single WARNING finding", () => {
    renderWithIntl(
      <FileCard file={FILE} findings={makeApi([makeFinding({ severity: "WARNING" })])} initialOpen />,
    );
    expect(screen.getByTestId("file-dot")).toHaveStyle({ background: "var(--warn)" });
  });

  it("uses the most severe active finding's colour when CRITICAL + SUGGESTION are both present", () => {
    renderWithIntl(
      <FileCard
        file={FILE}
        findings={makeApi([
          makeFinding({ id: "f1", severity: "SUGGESTION" }),
          makeFinding({ id: "f2", severity: "CRITICAL" }),
        ])}
        initialOpen
      />,
    );
    expect(screen.getByTestId("file-dot")).toHaveStyle({ background: "var(--crit)" });
  });

  it("no dot when the file has only accepted findings", () => {
    renderWithIntl(
      <FileCard
        file={FILE}
        findings={makeApi([makeFinding({ accepted_at: "2026-01-01T00:00:00Z" })])}
        initialOpen
      />,
    );
    expect(screen.queryByTestId("file-dot")).not.toBeInTheDocument();
  });
});

describe("FileCard — end-of-file block (AC-29)", () => {
  it("a finding on a line outside the rendered patch lands in the end-of-file block, not on a code line", () => {
    renderWithIntl(
      <FileCard
        file={FILE}
        findings={makeApi([makeFinding({ start_line: 999 })])}
        initialOpen
      />,
    );
    expect(screen.getByText("Outside the rendered diff")).toBeInTheDocument();
    expect(screen.getByText("Line 999")).toBeInTheDocument();
  });
});

describe("FileCard — severity chip jumps to the finding", () => {
  it("scrolls on every chip click, even when the file is already open and the target line is unchanged", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    renderWithIntl(
      <FileCard file={FILE} findings={makeApi([makeFinding({ severity: "WARNING" })])} initialOpen />,
    );
    const chip = screen.getByRole("button", { name: /1/ });

    fireEvent.click(chip);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // Second click: file still open, same target line → must scroll again.
    fireEvent.click(chip);
    expect(scrollSpy).toHaveBeenCalledTimes(2);

    rafSpy.mockRestore();
  });
});

describe("FileCard — shared Show/Hide switch hides inline finding annotations", () => {
  it("showInline=false hides markers and the outside-the-diff block but keeps the dot and chips", () => {
    const api = {
      ...makeApi([
        makeFinding({ id: "f1", title: "On a line", start_line: 2 }),
        makeFinding({ id: "f2", title: "Outside", start_line: 999 }),
      ]),
      showInline: false,
    };
    renderWithIntl(<FileCard file={FILE} findings={api} initialOpen />);
    expect(screen.queryByTitle("On a line")).not.toBeInTheDocument();
    expect(screen.queryByText("Outside the rendered diff")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-dot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2/ })).toBeInTheDocument();
  });

  it("clicking a severity chip while annotations are hidden asks to reveal them", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onRevealInline = vi.fn();
    const api = { ...makeApi([makeFinding()]), showInline: false, onRevealInline };
    renderWithIntl(<FileCard file={FILE} findings={api} initialOpen />);
    fireEvent.click(screen.getByRole("button", { name: /1/ }));
    expect(onRevealInline).toHaveBeenCalledTimes(1);
  });
});
