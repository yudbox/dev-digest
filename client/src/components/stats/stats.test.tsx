import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import statsMessages from "@messages/en/stats.json";
import { PeriodProvider, usePeriod } from "@/lib/contexts/periodContext";
import { notify } from "@/lib/contexts/toast";
import {
  AcceptRateValue,
  AgentIcon,
  CategoryDonut,
  CostSourceBadge,
  DateRangePicker,
  PeriodHeader,
  PeriodSelect,
  RunsWithoutCost,
  StatsEmpty,
  StatsError,
  StatsSkeleton,
  SyncCiButton,
  agentColor,
} from "./index";

const fetchMock = vi.fn();

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ stats: statsMessages }}>
      <QueryClientProvider client={qc}>
        <PeriodProvider>{ui}</PeriodProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.restoreAllMocks());

describe("agent identity", () => {
  it("gives the same agent the same colour every time, and a neutral one to deleted agents", () => {
    expect(agentColor("agent-1")).toBe(agentColor("agent-1"));
    expect(agentColor(null)).toBe("var(--text-muted)");
    const colors = new Set(Array.from({ length: 40 }, (_, i) => agentColor(`id-${i}`)));
    expect(colors.size).toBeGreaterThan(3);
  });

  it("renders the shared tile with the agent's colour", () => {
    render(<AgentIcon id="agent-1" />);
    expect(screen.getByTestId("agent-icon")).toHaveAttribute("data-color", agentColor("agent-1"));
  });
});

describe("CostSourceBadge", () => {
  it.each([
    ["billed", "billed"],
    ["estimated", "estimated"],
    ["mixed", "mixed"],
  ] as const)("shows %s with an explanatory tooltip", (source, text) => {
    wrap(<CostSourceBadge source={source} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByTestId("cost-source-badge").getAttribute("title")).toBeTruthy();
  });

  it("renders nothing when no run has a recorded source (no 'unknown' badge)", () => {
    const { container } = wrap(<CostSourceBadge source={null} />);
    expect(container.querySelector("[data-testid=cost-source-badge]")).toBeNull();
    expect(screen.queryByText(/unknown/i)).toBeNull();
  });
});

describe("RunsWithoutCost", () => {
  it("is hidden at 0 (and never prints a literal 0) and pluralises otherwise", () => {
    const { container, rerender } = wrap(<RunsWithoutCost count={0} />);
    expect(container.textContent).toBe("");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ stats: statsMessages }}>
        <QueryClientProvider client={new QueryClient()}>
          <PeriodProvider>
            <RunsWithoutCost count={1} />
          </PeriodProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 run without cost")).toBeInTheDocument();
  });
});

describe("AcceptRateValue", () => {
  it("always shows the denominator", () => {
    wrap(<AcceptRateValue accepted={30} resolved={40} />);
    expect(screen.getByText("75% (30/40)")).toBeInTheDocument();
  });

  it("is green from 60% and warning below", () => {
    const { rerender } = wrap(<AcceptRateValue accepted={59} resolved={100} />);
    expect(screen.getByTestId("accept-value").style.color).toBe("var(--warn)");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ stats: statsMessages }}>
        <QueryClientProvider client={new QueryClient()}>
          <PeriodProvider>
            <AcceptRateValue accepted={60} resolved={100} />
          </PeriodProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("accept-value").style.color).toBe("var(--ok)");
  });

  it("marks a small sample under 5 decisions but not at 5", () => {
    const four = wrap(<AcceptRateValue accepted={3} resolved={4} />);
    expect(screen.getByTestId("small-sample-badge")).toBeInTheDocument();
    four.unmount();
    wrap(<AcceptRateValue accepted={4} resolved={5} />);
    expect(screen.queryByTestId("small-sample-badge")).toBeNull();
  });

  it("shows a dash, no 0% and no small-sample mark when nothing was decided", () => {
    wrap(<AcceptRateValue accepted={0} resolved={0} />);
    expect(screen.getByTestId("accept-value")).toHaveTextContent("—");
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByTestId("small-sample-badge")).toBeNull();
  });

  it("states what the rate is based on", () => {
    wrap(<AcceptRateValue accepted={1} resolved={2} caption localFindings={2} />);
    expect(screen.getByText("based on 2 local findings")).toBeInTheDocument();
  });
});

describe("CategoryDonut", () => {
  const cats = (counts: number[]) =>
    (["security", "bug", "perf", "style", "test"] as const).map((category, i) => ({ category, count: counts[i]! }));

  it("lists all five categories in the fixed order, with counts and shares and no currency sign", () => {
    const { container } = wrap(<CategoryDonut categories={cats([48, 22, 14, 11, 5])} />);
    for (const text of ["48 · 48%", "22 · 22%", "14 · 14%", "11 · 11%", "5 · 5%"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(container.textContent).not.toContain("$");
    const labels = ["security", "bug", "perf", "style", "test"].map((l) => container.textContent!.indexOf(l));
    expect([...labels].sort((a, b) => a - b)).toEqual(labels);
    expect(screen.getByTestId("donut-center")).toHaveTextContent("100");
  });

  it("keeps a zero category in the legend as 0 · 0%", () => {
    wrap(<CategoryDonut categories={cats([5, 3, 0, 0, 0])} />);
    expect(screen.getAllByText("0 · 0%")).toHaveLength(3);
  });

  it("shows a small-sample mark under 10 findings only", () => {
    const few = wrap(<CategoryDonut categories={cats([3, 2, 0, 0, 0])} />);
    expect(screen.getByTestId("small-sample-badge")).toBeInTheDocument();
    few.unmount();
    wrap(<CategoryDonut categories={cats([6, 4, 0, 0, 0])} />);
    expect(screen.queryByTestId("small-sample-badge")).toBeNull();
  });

  it("with no findings keeps the card: grey ring, zero legend, message in the middle", () => {
    wrap(<CategoryDonut categories={cats([0, 0, 0, 0, 0])} />);
    expect(screen.getByTestId("donut-center")).toHaveTextContent("No findings in this period");
    expect(screen.getAllByText("0 · 0%")).toHaveLength(5);
    expect(screen.queryByTestId("small-sample-badge")).toBeNull();
  });
});

describe("DateRangePicker", () => {
  it("bounds the inputs so more than 30 days or the future cannot be picked", () => {
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ stats: statsMessages }}>
        <DateRangePicker from="2026-10-01" to="2026-10-10" onChange={onChange} today="2026-10-11" />
      </NextIntlClientProvider>,
    );
    const from = screen.getByLabelText("From") as HTMLInputElement;
    const to = screen.getByLabelText("To") as HTMLInputElement;
    expect(to.max).toBe("2026-10-11"); // min(from+29d, today)
    expect(from.min).toBe("2026-09-11"); // to − 29d
    expect(from.max).toBe("2026-10-10");
  });

  it("clamps a typed range that would exceed 30 days", () => {
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ stats: statsMessages }}>
        <DateRangePicker from="2026-10-01" to="2026-10-10" onChange={onChange} today="2026-10-11" />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-01" } });
    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-30" });
  });
});

describe("PeriodSelect + PeriodHeader", () => {
  function Probe() {
    const { period } = usePeriod();
    return <span data-testid="period">{period.kind}</span>;
  }

  it("shows the current period, switches it from the dropdown and persists it", async () => {
    wrap(
      <>
        <PeriodSelect />
        <Probe />
      </>,
    );
    await screen.findByText("30 days");
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(screen.getByText("1 day"));
    expect(screen.getByTestId("period")).toHaveTextContent("1d");
    expect(JSON.parse(localStorage.getItem("dd-period")!)).toEqual({ kind: "1d" });
  });

  it("picking Custom range opens the date picker with the last 7 days", async () => {
    wrap(
      <>
        <PeriodSelect />
        <Probe />
      </>,
    );
    await screen.findByText("30 days");
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(screen.getByText("Custom range"));
    expect(screen.getByTestId("period")).toHaveTextContent("custom");
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
  });

  it("shows the Sync CI button only when asked to", async () => {
    const off = wrap(<PeriodHeader />);
    await screen.findByText("30 days");
    expect(screen.queryByRole("button", { name: /Sync CI/ })).toBeNull();
    off.unmount();
    wrap(<PeriodHeader showSyncCi />);
    expect(await screen.findByRole("button", { name: /Sync CI/ })).toBeInTheDocument();
  });

  it("captions the resolved window next to the selector", async () => {
    const window = {
      kind: "1d" as const,
      from: "2026-10-10T16:00:00.000Z",
      to: "2026-10-11T09:22:00.000Z",
      tz: "UTC",
      days: 1,
      bucketKind: "hour" as const,
      buckets: [],
      previous: { from: "", to: "" },
    };
    wrap(<PeriodHeader window={window} />);
    expect(await screen.findByTestId("window-caption")).toHaveTextContent("1 day · Oct 10 16:00 – now");
  });
});

describe("SyncCiButton", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

  it("POSTs the CI refresh once, is disabled meanwhile, and toasts how many runs came in", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((res) => (release = res)));
    const success = vi.spyOn(notify, "success").mockImplementation(() => {});
    wrap(<SyncCiButton />);

    const button = screen.getByRole("button", { name: /Sync CI/ });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    fireEvent.click(screen.getByRole("button")); // a second click while pending does nothing
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/ci-runs\/refresh$/);
    expect(fetchMock.mock.calls[0]![1].method).toBe("POST");

    release(ok({ synced_at: "now", ingested: 3, installations_checked: 1 }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Imported 3 CI runs"));
    expect(screen.getByRole("button", { name: /Sync CI/ })).not.toBeDisabled();
  });

  it("says '1 CI run' in the singular", async () => {
    fetchMock.mockResolvedValue(ok({ synced_at: "now", ingested: 1, installations_checked: 1 }));
    const success = vi.spyOn(notify, "success").mockImplementation(() => {});
    wrap(<SyncCiButton />);
    fireEvent.click(screen.getByRole("button", { name: /Sync CI/ }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Imported 1 CI run"));
  });

  it("on failure does not toast a success and does not double-toast the (global) error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "x", json: async () => ({}) } as Response);
    const success = vi.spyOn(notify, "success").mockImplementation(() => {});
    const error = vi.spyOn(notify, "error").mockImplementation(() => {});
    wrap(<SyncCiButton />);
    fireEvent.click(screen.getByRole("button", { name: /Sync CI/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Sync CI/ })).not.toBeDisabled());
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled(); // the app-level MutationCache owns error toasts
  });
});

describe("state components", () => {
  it("the skeleton never shows a digit, zero or dash", () => {
    render(<StatsSkeleton />);
    const text = screen.getByTestId("stats-skeleton").textContent ?? "";
    expect(text).toBe("");
  });

  it("the error state offers Retry and shows no numbers", () => {
    const onRetry = vi.fn();
    wrap(<StatsError onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\d/);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("the empty state is text only: no button, no link", () => {
    const { container } = render(<StatsEmpty title="No agent runs yet" body="Nothing is collected until the first run." />);
    expect(screen.getByText("No agent runs yet")).toBeInTheDocument();
    expect(within(container).queryByRole("button")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});
