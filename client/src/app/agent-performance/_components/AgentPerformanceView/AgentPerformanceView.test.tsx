import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentPerformanceResponse, AgentPerfRow } from "@devdigest/shared";
import statsMessages from "@messages/en/stats.json";
import perfMessages from "@messages/en/agentPerformance.json";
import { PeriodProvider } from "@/lib/contexts/periodContext";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { AgentPerformanceView } from "./AgentPerformanceView";

const fetchMock = vi.fn();

const window30 = {
  kind: "30d" as const,
  from: "2026-09-11T09:22:00.000Z",
  to: "2026-10-11T09:22:00.000Z",
  tz: "UTC",
  days: 30,
  bucketKind: "week" as const,
  buckets: [0, 1, 2, 3, 4].map((i) => {
    const day = 86_400_000;
    const start = Date.parse("2026-09-11T09:22:00.000Z") + i * 7 * day;
    return {
      label: `W${i + 1}`,
      start: new Date(start).toISOString(),
      end: new Date(Math.min(start + 7 * day, Date.parse("2026-10-11T09:22:00.000Z"))).toISOString(),
      partial: i === 4,
    };
  }),
  previous: { from: "2026-08-12T09:22:00.000Z", to: "2026-09-11T09:22:00.000Z" },
};

const row = (over: Partial<AgentPerfRow> & { name: string }): AgentPerfRow => ({
  id: `id-${over.name}`,
  enabled: true,
  runs: 10,
  totalCostUsd: 1,
  avgCostUsd: 0.1,
  runsWithoutCost: 0,
  avgDurationMs: 6200,
  accept: { accepted: 0, resolved: 0 },
  previousAccept: null,
  lastRunAt: "2026-10-11T09:18:00.000Z",
  costSource: null,
  recentRuns: [
    { id: "r1", ranAt: "2026-10-11T09:18:00.000Z", status: "done", durationMs: 6000, costUsd: 0.04 },
    { id: "r2", ranAt: "2026-10-10T09:18:00.000Z", status: "done", durationMs: 6400, costUsd: 0.04 },
  ],
  ...over,
});

function response(over: Partial<AgentPerformanceResponse> = {}): AgentPerformanceResponse {
  return {
    window: window30,
    hasAnyRuns: true,
    hasCiInstallations: false,
    kpis: {
      totalRuns: 253,
      sparkline: [40, 50, 55, 60, 48],
      totalCostUsd: 10.75,
      costSource: "mixed",
      runsWithoutCost: 3,
      costDeltaUsd: -1.2,
      accept: { accepted: 111, resolved: 152 },
      mostActive: { agentId: "id-Security", name: "Security Reviewer", runs: 142, accept: { accepted: 78, resolved: 100 } },
    },
    agents: [
      row({ name: "Security Reviewer", id: "id-Security", runs: 142, accept: { accepted: 78, resolved: 100 }, previousAccept: { accepted: 36, resolved: 50 } }),
      row({ name: "Performance Reviewer", id: "id-Perf", runs: 87, accept: { accepted: 32, resolved: 50 }, previousAccept: { accepted: 36, resolved: 50 } }),
      row({ name: "Custom Mentor", id: "id-Mentor", runs: 0, avgCostUsd: null, avgDurationMs: null, lastRunAt: null, recentRuns: [] }),
      row({ id: null, name: "Deleted agents", runs: 5, accept: { accepted: 0, resolved: 0 } }),
    ],
    costByAgent: [
      { key: "id-Security", label: "Security Reviewer", costUsd: 5.68, kind: "agent", hidden: [] },
      { key: "id-Perf", label: "Performance Reviewer", costUsd: 4.35, kind: "agent", hidden: [] },
      { key: "id-Mentor", label: "Custom Mentor", costUsd: 0.72, kind: "agent", hidden: [] },
    ],
    costByModel: [
      { key: "gpt-4.1", label: "gpt-4.1", costUsd: 6.1, kind: "model", hidden: [] },
      { key: "gpt-4o", label: "gpt-4o", costUsd: 4.23, kind: "model", hidden: [] },
      { key: "gpt-4o-mini", label: "gpt-4o-mini", costUsd: 0.42, kind: "model", hidden: [] },
    ],
    ...over,
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ stats: statsMessages, agentPerformance: perfMessages }}>
      <QueryClientProvider client={qc}>
        <PeriodProvider>
          <AgentPerformanceView />
        </PeriodProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

/** The table row of an agent (its name also appears in the KPI card and the donut legend). */
const rowOf = (name: string): HTMLElement =>
  screen.getAllByTestId("agent-row").find((r) => r.getAttribute("data-agent") === name)!;
/** The clickable line of a row (the first child), which toggles the expansion. */
const lineOf = (name: string): HTMLElement => rowOf(name).firstElementChild as HTMLElement;

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const methods = () => fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? "GET");

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.restoreAllMocks());

describe("loading and error never invent numbers", () => {
  it("shows skeletons — no KPI cards, no digits — while loading", async () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
    mount();
    expect(await screen.findByTestId("stats-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("stats-skeleton").textContent).toBe("");
    expect(screen.queryByTestId("kpi-total-runs")).toBeNull();
    expect(screen.queryByTestId("agent-table")).toBeNull();
  });

  it("shows an error with Retry and no numbers; Retry repeats only the failed GET", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "x", json: async () => ({}) } as Response);
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\d/);
    expect(screen.queryByTestId("kpi-total-runs")).toBeNull();
    const before = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue(ok(response()));
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await screen.findByTestId("kpi-total-runs");
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(urls().at(-1)).toMatch(/\/agent-performance\?/);
  });
});

describe("three different empty states", () => {
  it("never ran: the whole page is one text-only empty state, no button, no link", async () => {
    fetchMock.mockResolvedValue(ok(response({ hasAnyRuns: false, kpis: { ...response().kpis, totalRuns: 0 }, agents: [] })));
    mount();
    const empty = await screen.findByTestId("empty-never-ran");
    expect(within(empty).getByText("No agent runs yet")).toBeInTheDocument();
    expect(within(empty).getByText(/fills in automatically/)).toBeInTheDocument();
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(empty.querySelector("a")).toBeNull();
    expect(screen.queryByTestId("agent-table")).toBeNull();
  });

  it("runs exist but none in the period: keeps the selector, says so, no button or link", async () => {
    fetchMock.mockResolvedValue(ok(response({ kpis: { ...response().kpis, totalRuns: 0, mostActive: null }, agents: [] })));
    mount();
    const empty = await screen.findByTestId("empty-no-runs-in-window");
    expect(within(empty).getByText("No runs in the last 30 days")).toBeInTheDocument();
    expect(within(empty).getByText("Try a longer period")).toBeInTheDocument();
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Period" })).toBeInTheDocument(); // can still switch period
  });

  it("an agent without runs is a table ROW (Runs 0 and dashes), not an empty state", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    mount();
    await screen.findByTestId("agent-table");
    expect(screen.queryByTestId("empty-never-ran")).toBeNull();
    expect(screen.queryByTestId("empty-no-runs-in-window")).toBeNull();
    const mentor = rowOf("Custom Mentor");
    expect(within(mentor).getByText("0")).toBeInTheDocument();
    expect(within(mentor).getAllByText("—").length).toBeGreaterThanOrEqual(4); // avg cost, avg dur, accept, last run
  });
});

describe("content", () => {
  it("renders the four KPIs without any period suffix", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    const { container } = mount();
    await screen.findByTestId("kpi-total-runs");
    expect(within(screen.getByTestId("kpi-total-runs")).getByText("253")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-total-cost")).getByText(/\$10\.75/)).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-total-cost")).getByTestId("cost-delta")).toHaveTextContent("-$1.20");
    expect(within(screen.getByTestId("kpi-total-cost")).getByText("mixed")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-total-cost")).getByText("3 runs without cost")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-avg-accept")).getByText("73% (111/152)")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-avg-accept")).getByText("based on 152 local findings")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-most-active")).getByText("Security Reviewer")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-most-active")).getByText("142 runs · 78% accept")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/30D/i);
    expect(screen.getByTestId("sort-runs").textContent).toBe("Runs");
  });

  it("omits the cost delta and explains why when history does not cover the previous period", async () => {
    fetchMock.mockResolvedValue(ok(response({ kpis: { ...response().kpis, costDeltaUsd: null } })));
    mount();
    await screen.findByTestId("kpi-total-cost");
    expect(screen.queryByTestId("cost-delta")).toBeNull();
    expect(within(screen.getByTestId("kpi-total-cost")).getByTitle("Not enough history to compare")).toBeInTheDocument();
  });

  it("sorts by Accept descending by default, with agents that have no decisions last", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    mount();
    await screen.findByTestId("agent-table");
    const order = screen.getAllByTestId("agent-row").map((r) => r.getAttribute("data-agent"));
    expect(order).toEqual(["Security Reviewer", "Performance Reviewer", "Custom Mentor", "Deleted agents"]);
  });

  it("shows ↑ for a rising accept rate with the previous fraction, and flags small samples", async () => {
    fetchMock.mockResolvedValue(
      ok(
        response({
          agents: [
            row({ name: "Rising", id: "id-r", accept: { accepted: 78, resolved: 100 }, previousAccept: { accepted: 36, resolved: 50 } }),
            row({ name: "Tiny", id: "id-t", accept: { accepted: 3, resolved: 3 } }),
          ],
        }),
      ),
    );
    mount();
    await screen.findByTestId("agent-table");
    const rising = rowOf("Rising");
    const arrow = within(rising).getByTestId("accept-arrow");
    expect(arrow).toHaveAttribute("data-direction", "up");
    expect(arrow).toHaveAttribute("title", "was 72% (36/50)");
    const tiny = rowOf("Tiny");
    expect(within(tiny).getByTestId("small-sample-badge")).toBeInTheDocument();
    expect(within(tiny).queryByTestId("accept-arrow")).toBeNull();
    expect(within(tiny).getByTestId("accept-arrow-none").getAttribute("title")).toMatch(/No data for the previous 30 days/);
  });

  it("renders both cost donuts with the total in the middle and the cost-source badge", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    mount();
    const byAgent = await screen.findByTestId("donut-byAgent");
    const byModel = screen.getByTestId("donut-byModel");
    expect(within(byAgent).getByText("$5.68")).toBeInTheDocument();
    expect(within(byModel).getByText("gpt-4.1")).toBeInTheDocument();
    expect(within(byAgent).getByTestId("donut-center")).toHaveTextContent("$10.75");
    expect(within(screen.getByTestId("cost-breakdown")).getAllByText("mixed").length).toBeGreaterThan(0);
  });

  it("names folded segments 'Other (N models)' and the deleted-agent segment in plain words", async () => {
    fetchMock.mockResolvedValue(
      ok(
        response({
          costByModel: [
            { key: "a", label: "a", costUsd: 5, kind: "model", hidden: [] },
            { key: null, label: "Other (3 models)", costUsd: 1, kind: "other", hidden: [{ label: "x", costUsd: 0.5 }, { label: "y", costUsd: 0.3 }, { label: "z", costUsd: 0.2 }] },
            { key: null, label: "Unknown model", costUsd: 0.1, kind: "unknown_model", hidden: [] },
          ],
          costByAgent: [{ key: null, label: "Deleted agents", costUsd: 6.1, kind: "deleted", hidden: [] }],
        }),
      ),
    );
    mount();
    expect(await screen.findByText("Other (3 models)")).toBeInTheDocument();
    expect(screen.getByText("Unknown model")).toBeInTheDocument();
    expect(within(screen.getByTestId("donut-byAgent")).getByText("Deleted agents")).toBeInTheDocument();
  });

  it("shows no 'Sync CI' button unless the workspace has a CI installation", async () => {
    fetchMock.mockResolvedValue(ok(response({ hasCiInstallations: false })));
    const off = mount();
    await screen.findByTestId("agent-table");
    expect(screen.queryByRole("button", { name: /Sync CI/ })).toBeNull();
    off.unmount();
    fetchMock.mockResolvedValue(ok(response({ hasCiInstallations: true })));
    mount();
    expect(await screen.findByRole("button", { name: /Sync CI/ })).toBeInTheDocument();
  });
});

describe("interaction never touches the network", () => {
  it("sorting and expanding issue no request; only GETs ever", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    mount();
    await screen.findByTestId("agent-table");
    const calls = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("sort-runs"));
    expect(screen.getAllByTestId("agent-row")[0]).toHaveAttribute("data-agent", "Security Reviewer");
    fireEvent.click(screen.getByTestId("sort-runs")); // toggles to ascending
    expect(screen.getAllByTestId("agent-row")[0]).toHaveAttribute("data-agent", "Custom Mentor");
    fireEvent.click(lineOf("Security Reviewer"));
    expect(screen.getByTestId("agent-row-expand")).toBeInTheDocument();
    fireEvent.click(lineOf("Security Reviewer"));
    expect(screen.queryByTestId("agent-row-expand")).toBeNull();

    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(methods().every((m) => m === "GET")).toBe(true);
  });

  it("expanding shows the agent's recent runs summary, or says there are none", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    mount();
    await screen.findByTestId("agent-table");
    fireEvent.click(lineOf("Security Reviewer"));
    expect(screen.getByTestId("agent-row-expand")).toHaveTextContent("avg 6.2s · $0.10");
    fireEvent.click(lineOf("Custom Mentor"));
    expect(screen.getByText("No runs in this period")).toBeInTheDocument();
  });

  it("View opens that agent's Stats tab and does not also toggle the row; deleted agents have no View", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    mount();
    await screen.findByTestId("agent-table");
    const security = rowOf("Security Reviewer");
    fireEvent.click(within(security).getByRole("button", { name: "View" }));
    expect(push).toHaveBeenCalledWith("/agents/id-Security?tab=stats");
    expect(screen.queryByTestId("agent-row-expand")).toBeNull();
    const deleted = rowOf("Deleted agents");
    expect(within(deleted).queryByRole("button", { name: "View" })).toBeNull();
  });

  it("sends the period to the API and refetches when it changes", async () => {
    fetchMock.mockResolvedValue(ok(response()));
    mount();
    await screen.findByTestId("agent-table");
    expect(urls()[0]).toMatch(/\/agent-performance\?range=30d&tz=/);
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(screen.getByText("1 day"));
    await waitFor(() => expect(urls().some((u) => /range=1d/.test(u))).toBe(true));
    expect(methods().every((m) => m === "GET")).toBe(true);
  });
});
