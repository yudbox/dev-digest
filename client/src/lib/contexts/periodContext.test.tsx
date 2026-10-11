import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PeriodProvider, usePeriod } from "./periodContext";
import { PERIOD_STORAGE_KEY } from "../utils/period";

function Probe() {
  const { period, setPeriod, query, ready } = usePeriod();
  return (
    <div>
      <span data-testid="kind">{period.kind}</span>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="query">{query}</span>
      <button onClick={() => setPeriod({ kind: "1d" })}>one-day</button>
      <button onClick={() => setPeriod({ kind: "custom", from: "2026-09-01", to: "2026-09-10" })}>custom</button>
    </div>
  );
}

const mount = () =>
  render(
    <PeriodProvider>
      <Probe />
    </PeriodProvider>,
  );

describe("PeriodProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("defaults to 30 days with empty storage and becomes ready with a tz-bearing query", async () => {
    mount();
    expect(await screen.findByText("true")).toBeInTheDocument(); // ready
    expect(screen.getByTestId("kind")).toHaveTextContent("30d");
    expect(screen.getByTestId("query").textContent).toMatch(/^range=30d&tz=/);
  });

  it("is not ready before the stored period has been read (no premature requests)", () => {
    // Capture the very first render, before effects run.
    const seen: string[] = [];
    function Spy() {
      seen.push(String(usePeriod().ready));
      return null;
    }
    render(
      <PeriodProvider>
        <Spy />
      </PeriodProvider>,
    );
    expect(seen[0]).toBe("false");
  });

  it("restores a stored period after mount", async () => {
    localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ kind: "1d" }));
    mount();
    expect(await screen.findByText("true")).toBeInTheDocument();
    expect(screen.getByTestId("kind")).toHaveTextContent("1d");
    expect(screen.getByTestId("query").textContent).toMatch(/^range=1d&tz=/);
  });

  it("persists a change and applies it to the query", async () => {
    mount();
    await screen.findByText("true");
    await act(async () => screen.getByText("one-day").click());
    expect(screen.getByTestId("kind")).toHaveTextContent("1d");
    expect(JSON.parse(localStorage.getItem(PERIOD_STORAGE_KEY)!)).toEqual({ kind: "1d" });
    await act(async () => screen.getByText("custom").click());
    expect(screen.getByTestId("query").textContent).toContain("from=");
  });

  it("falls back to 30 days when the stored value is corrupted", async () => {
    localStorage.setItem(PERIOD_STORAGE_KEY, "{broken");
    mount();
    await screen.findByText("true");
    expect(screen.getByTestId("kind")).toHaveTextContent("30d");
  });

  it("still works when localStorage throws (blocked storage)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mount();
    await screen.findByText("true");
    expect(screen.getByTestId("kind")).toHaveTextContent("30d");
    await act(async () => screen.getByText("one-day").click());
    expect(screen.getByTestId("kind")).toHaveTextContent("1d");
  });
});
