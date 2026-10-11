import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Donut } from "./Donut";
import { Sparkline } from "./Sparkline";
import { StackedBar } from "./StackedBar";

const segments = [
  { label: "security", value: 48, color: "red" },
  { label: "bug", value: 22, color: "orange" },
  { label: "style", value: 0, color: "blue" },
];

describe("Donut", () => {
  it("keeps the legacy currency format by default ($ + 2 decimals)", () => {
    render(<Donut segments={[{ label: "A", value: 5.68, color: "red" }]} />);
    expect(screen.getByText("$5.68")).toBeInTheDocument();
  });

  it("uses a custom value formatter and no currency sign for counts", () => {
    const { container } = render(
      <Donut segments={segments} valueFormatter={(s) => `${s.value} · ${Math.round((s.value / 70) * 100)}%`} />,
    );
    expect(screen.getByText("48 · 69%")).toBeInTheDocument();
    expect(screen.getByText("0 · 0%")).toBeInTheDocument();
    expect(container.textContent).not.toContain("$");
  });

  it("renders the total in the hole", () => {
    render(<Donut segments={segments} centerLabel="70" />);
    expect(screen.getByTestId("donut-center")).toHaveTextContent("70");
  });

  it("gives a zero segment a real arc when minVisible, and a degenerate one otherwise", () => {
    const pathOf = (container: HTMLElement) =>
      container.querySelector('.recharts-pie-sector path[fill="blue"]')?.getAttribute("d") ?? "";
    const sliver = render(<Donut segments={segments} minVisible />);
    const sliverPath = pathOf(sliver.container);
    sliver.unmount();
    const flat = render(<Donut segments={segments} />);
    const flatPath = pathOf(flat.container);
    expect(sliverPath).not.toBe("");
    expect(sliverPath).not.toBe(flatPath);
  });

  it("keeps the real 0 in the legend for a sliver segment", () => {
    render(<Donut segments={segments} minVisible valueFormatter={(s) => String(s.value)} />);
    expect(screen.getByText("style").parentElement).toHaveTextContent("0");
  });

  it("shows a grey ring, the legend of zeros and the empty text when every value is 0", () => {
    const zeros = segments.map((s) => ({ ...s, value: 0 }));
    const { container } = render(
      <Donut segments={zeros} valueFormatter={(s) => String(s.value)} emptyText="No findings in this period" centerLabel="0" />,
    );
    expect(screen.getByTestId("donut-center")).toHaveTextContent("No findings in this period");
    expect(screen.queryByText("70")).toBeNull();
    expect(container.querySelectorAll(".recharts-pie-sector")).toHaveLength(1); // the single grey ring
    expect(screen.getAllByText("0")).toHaveLength(3);
  });
});

describe("Sparkline", () => {
  it("renders hover titles per point when provided", () => {
    const { container } = render(<Sparkline data={[1, 3, 2]} pointTitles={["a", "b", "c"]} />);
    expect([...container.querySelectorAll("title")].map((t) => t.textContent)).toEqual(["a", "b", "c"]);
  });

  it("does not produce NaN for a single point", () => {
    const { container } = render(<Sparkline data={[5]} />);
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("StackedBar", () => {
  const data = [
    { label: "W1", tooltip: "W1: Sep 11 – Sep 18", critical: 2, warning: 5, suggestion: 8 },
    { label: "W2", tooltip: "W2: Sep 18 – Sep 25", critical: 0, warning: 0, suggestion: 0 },
    { label: "W3", tooltip: "W3: Sep 25 – now · partial", critical: 1, warning: 0, suggestion: 2 },
  ];

  it("renders one column and one label per bucket, with the legend", () => {
    render(<StackedBar data={data} />);
    expect(screen.getAllByTestId("stacked-bar-column")).toHaveLength(3);
    for (const l of ["W1", "W2", "W3"]) expect(screen.getByText(l)).toBeInTheDocument();
    for (const l of ["Critical", "Warning", "Suggestion"]) expect(screen.getByText(l)).toBeInTheDocument();
  });

  it("stacks only non-zero severities, so an empty bucket is an empty column", () => {
    render(<StackedBar data={data} />);
    const [w1, w2, w3] = screen.getAllByTestId("stacked-bar-column");
    expect(within(w1!).getAllByTestId(/stacked-bar-(critical|warning|suggestion)/)).toHaveLength(3);
    expect(within(w2!).queryAllByTestId(/stacked-bar-/)).toHaveLength(0);
    expect(within(w3!).queryByTestId("stacked-bar-warning")).toBeNull();
  });

  it("shows the exact range on hover and via the native title", () => {
    render(<StackedBar data={data} />);
    const [, , w3] = screen.getAllByTestId("stacked-bar-column");
    expect(w3).toHaveAttribute("title", "W3: Sep 25 – now · partial");
    fireEvent.mouseEnter(w3!);
    expect(screen.getByTestId("stacked-bar-hover")).toHaveTextContent("W3: Sep 25 – now · partial");
    fireEvent.mouseLeave(w3!);
    expect(screen.getByTestId("stacked-bar-hover")).toBeEmptyDOMElement();
  });

  it("does not crash with no data", () => {
    render(<StackedBar data={[]} />);
    expect(screen.queryAllByTestId("stacked-bar-column")).toHaveLength(0);
  });
});
