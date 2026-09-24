import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ArchitectureSection as ArchitectureSectionType } from "@devdigest/shared";
import messages from "@messages/en/onboarding.json";

// MermaidDiagram lazily imports the real `mermaid` package and renders async
// SVG via ref.innerHTML — mock the component at the boundary so drill-down
// interaction tests are deterministic and don't depend on mermaid internals.
vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid-diagram">{chart}</div>
  ),
  looksLikeMermaid: (src: string) =>
    /^\s*(flowchart|graph)\b/.test(src.trim()),
}));

import { ArchitectureSectionView } from "./ArchitectureSection";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const SECTION: ArchitectureSectionType = {
  overview: "A fullstack monolith with a Fastify API and a Next.js client.",
  style: "fullstack-monolith",
  nodes: [
    { id: "api", label: "API", kind: "package", detail: "flowchart TD\n  a --> b" },
    { id: "web", label: "Web", kind: "package", detail: "flowchart TD\n  c --> d" },
    {
      id: "overflow1",
      label: "+3 more",
      kind: "file",
      isOverflow: true,
      detail: "server/src/a.ts\nserver/src/b.ts\nserver/src/c.ts",
    },
  ],
  edges: [{ from: "web", to: "api", label: "calls" }],
};

describe("ArchitectureSectionView", () => {
  it("renders the overview and inline diagram", () => {
    renderWithIntl(<ArchitectureSectionView section={SECTION} />);
    expect(screen.getByText(SECTION.overview)).toBeInTheDocument();
    expect(screen.getByTestId("mermaid-diagram")).toBeInTheDocument();
  });

  it("sanitizes real package/file names used as node ids into safe Mermaid tokens (bugfix: diagram silently vanished for ids like '@devdigest/web')", () => {
    const section: ArchitectureSectionType = {
      overview: "A monorepo.",
      style: "monorepo",
      nodes: [
        { id: "@devdigest/web", label: "@devdigest/web", kind: "package" },
        { id: "@devdigest/api", label: "@devdigest/api", kind: "package" },
        { id: "server/src/db/schema.ts", label: "schema.ts", kind: "file" },
      ],
      edges: [
        { from: "@devdigest/web", to: "@devdigest/api", label: "calls" },
        { from: "@devdigest/api", to: "server/src/db/schema.ts" },
      ],
    };
    renderWithIntl(<ArchitectureSectionView section={section} />);
    const chart = screen.getByTestId("mermaid-diagram").textContent ?? "";
    // The raw ids must never appear as bare (unquoted) Mermaid node tokens —
    // only inside quoted label text — and every edge must still resolve to
    // a real synthetic node id, not a dangling reference.
    expect(chart).not.toMatch(/^\s*@devdigest\/web(?!")/m);
    expect(chart).toMatch(/n0\["@devdigest\/web"\]/);
    expect(chart).toMatch(/n1\["@devdigest\/api"\]/);
    expect(chart).toMatch(/n0 -->.*n1/);
    expect(chart).toMatch(/n1 -->.*n2/);
  });

  it("clicking a top node opens a modal containing a MermaidDiagram (AC-29, level 2)", () => {
    renderWithIntl(<ArchitectureSectionView section={SECTION} />);
    fireEvent.click(screen.getByText("API"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByTestId("mermaid-diagram")).toHaveLength(2);
    // Level-3 list must not be present for a regular node's modal.
    expect(screen.queryByText("server/src/a.ts")).not.toBeInTheDocument();
  });

  it("clicking the overflow node opens a modal with a scrollable list, each item expandable (AC-29, level 3)", () => {
    renderWithIntl(<ArchitectureSectionView section={SECTION} />);
    fireEvent.click(screen.getByText("+3 more"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("server/src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("server/src/b.ts")).toBeInTheDocument();
    expect(screen.getByText("server/src/c.ts")).toBeInTheDocument();

    // Each item opens its own detail view on click.
    expect(screen.queryByText(/server\/src\/a\.ts was grouped/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("server/src/a.ts"));
    expect(screen.getByText(/server\/src\/a\.ts was grouped/)).toBeInTheDocument();
  });

  it("closes the modal on ESC", () => {
    renderWithIntl(<ArchitectureSectionView section={SECTION} />);
    fireEvent.click(screen.getByText("API"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
