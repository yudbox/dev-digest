import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentRunItem, AgentStatsResponse } from "@devdigest/shared";
import statsMessages from "@messages/en/stats.json";
import agentsMessages from "@messages/en/agents.json";
import { PeriodProvider } from "@/lib/contexts/periodContext";

// The drawer is shared and has its own tests; here we only care that it opens.
vi.mock("@/components/run-trace-drawer", () => ({
  default: ({ runId, findings, onClose }: { runId: string; findings?: unknown[]; onClose: () => void }) => (
    <div data-testid="trace-drawer" data-run={runId} data-findings={findings ? findings.length : "loading"}>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import { StatsTab } from "./StatsTab";

const fetchMock = vi.fn();
let intersect: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
const observed: Element[] = [];

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

function stats(over: Partial<AgentStatsResponse> = {}): AgentStatsResponse {
  return {
    window: window30,
    hasAnyRuns: true,
    hasCiInstallations: false,
    agent: { id: "ag1", name: "Security Reviewer", enabled: true },
    kpis: {
      runs: 142,
      totalCostUsd: 5.68,
      avgCostUsd: 0.04,
      runsWithoutCost: 2,
      avgDurationMs: 6200,
      accept: { accepted: 30, resolved: 40 },
      previousAccept: null,
      lastRunAt: "2026-10-11T09:00:00.000Z",
      costSource: "mixed",
      recentRuns: [],
      sparkline: [20, 30, 28, 35, 29],
      avgCostDeltaUsd: -0.01,
    },
    skills: [
      { skillId: "s1", name: "secret-leakage-gate", applied: 9, loaded: 10 },
      { skillId: "s2", name: "no-then-chains", applied: 3, loaded: 10 },
    ],
    memory: [{ memoryId: "m1", preview: "raw-body parser intentional", pulled: 6, tracked: 10 }],
    hasSkillsAttached: true,
    skillsTrackingSince: "2026-09-20T00:00:00.000Z",
    memoryTrackingSince: "2026-09-20T00:00:00.000Z",
    severityBuckets: window30.buckets.map((b, i) => ({ ...b, critical: i, warning: 2, suggestion: 1 })),
    findingsTotal: 48,
    categories: [
      { category: "security", count: 24 },
      { category: "bug", count: 12 },
      { category: "perf", count: 6 },
      { category: "style", count: 4 },
      { category: "test", count: 2 },
    ],
    ...over,
  };
}

const run = (over: Partial<AgentRunItem> & { id: string }): AgentRunItem => ({
  ranAt: "2026-10-11T09:14:00.000Z",
  status: "done",
  error: null,
  pr: { number: 482, repoId: "repo-1", githubUrl: null },
  tokensIn: 12_000,
  tokensOut: 4_000,
  costUsd: 0.06,
  costSource: "api",
  findingsCount: 3,
  source: "local",
  hasTrace: true,
  ciRunUrl: null,
  ...over,
});

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

/** Route fetch by URL: stats → data, runs → paged by cursor, findings → one finding. */
function route(opts: { stats?: AgentStatsResponse; pages?: { items: AgentRunItem[]; nextCursor: string | null }[]; findings?: unknown[] } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = new URL(url);
    if (u.pathname === "/agents/ag1/stats") return ok(opts.stats ?? stats());
    if (u.pathname === "/agents/ag1/runs") {
      const pages = opts.pages ?? [{ items: [run({ id: "r1" })], nextCursor: null }];
      const cursor = u.searchParams.get("cursor");
      return ok(cursor ? pages[1] ?? { items: [], nextCursor: null } : pages[0]);
    }
    if (u.pathname.startsWith("/runs/") && u.pathname.endsWith("/findings")) return ok({ items: opts.findings ?? [{ id: "f1" }, { id: "f2" }] });
    return ok({});
  });
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ stats: statsMessages, agents: agentsMessages }}>
      <QueryClientProvider client={qc}>
        <PeriodProvider>
          <StatsTab agentId="ag1" agentName="Security Reviewer" />
        </PeriodProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const methods = () => fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? "GET");
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  intersect = null;
  observed.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => vi.restoreAllMocks());

describe("states", () => {
  it("loading: skeleton only, no digits", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    mount();
    expect(await screen.findByTestId("stats-skeleton")).toHaveTextContent("");
    expect(screen.queryByTestId("kpi-runs")).toBeNull();
  });

  it("error: Retry, no numbers, and Retry repeats only the failed request", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "x", json: async () => ({}) } as Response);
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\d/);
    const before = fetchMock.mock.calls.length;
    route();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await screen.findByTestId("kpi-runs");
    const stats = urls().slice(before).filter((u) => u.includes("/stats"));
    expect(stats).toHaveLength(1);
  });

  it("never ran: text-only empty state, no button or link", async () => {
    route({ stats: stats({ hasAnyRuns: false, kpis: { ...stats().kpis, runs: 0 } }) });
    mount();
    const empty = await screen.findByTestId("stats-never-ran");
    expect(within(empty).getByText("This agent hasn't run yet")).toBeInTheDocument();
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(empty.querySelector("a")).toBeNull();
  });

  it("no runs in the period: keeps the selector and says so", async () => {
    route({ stats: stats({ kpis: { ...stats().kpis, runs: 0 } }) });
    mount();
    const empty = await screen.findByTestId("stats-no-runs");
    expect(within(empty).getByText("No runs in this period")).toBeInTheDocument();
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Period" })).toBeInTheDocument();
  });
});

describe("KPIs", () => {
  it("shows runs, avg cost with source and missing-cost note, duration and the accept rate with its denominator", async () => {
    route();
    const { container } = mount();
    await screen.findByTestId("kpi-runs");
    expect(within(screen.getByTestId("kpi-runs")).getByText("142")).toBeInTheDocument();
    const cost = screen.getByTestId("kpi-avg-cost");
    expect(within(cost).getByText(/\$0\.04/)).toBeInTheDocument();
    expect(within(cost).getByText("mixed")).toBeInTheDocument();
    expect(within(cost).getByText("2 runs without cost")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-avg-duration")).getByText("6.2s")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-accept")).getByText("75% (30/40)")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/30D/i);
  });

  it("shows the avg-cost delta only when the server provides it, otherwise explains why not", async () => {
    route({ stats: stats({ kpis: { ...stats().kpis, avgCostDeltaUsd: null } }) });
    mount();
    await screen.findByTestId("kpi-avg-cost");
    expect(screen.queryByTestId("avg-cost-delta")).toBeNull();
    expect(within(screen.getByTestId("kpi-avg-cost")).getByTitle("Not enough history to compare")).toBeInTheDocument();
  });

  it("renders no accept percentage when nothing has been decided", async () => {
    route({ stats: stats({ kpis: { ...stats().kpis, accept: { accepted: 0, resolved: 0 } } }) });
    mount();
    await screen.findByTestId("kpi-accept");
    expect(within(screen.getByTestId("kpi-accept")).getByTestId("accept-value")).toHaveTextContent("—");
  });
});

describe("skills, memory, severity, category", () => {
  it("lists skills and memory as bars with their share of runs", async () => {
    route();
    mount();
    const skills = await screen.findByTestId("skills-card");
    expect(within(skills).getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(within(skills).getByText("90%")).toBeInTheDocument();
    expect(within(skills).getByText("30%")).toBeInTheDocument();
    const memory = screen.getByTestId("memory-card");
    expect(within(memory).getByText("raw-body parser intentional")).toBeInTheDocument();
    expect(within(memory).getByText("60%")).toBeInTheDocument();
  });

  it("says 'No data before <date>' when the period starts before usage was recorded", async () => {
    route();
    mount();
    expect(await screen.findAllByText("No data before Sep 20")).toHaveLength(2);
  });

  it("does not claim missing data when the period is fully covered", async () => {
    route({ stats: stats({ skillsTrackingSince: "2026-09-01T00:00:00.000Z", memoryTrackingSince: "2026-09-01T00:00:00.000Z" }) });
    mount();
    await screen.findByTestId("skills-card");
    expect(screen.queryByText(/No data before/)).toBeNull();
  });

  it("explains empty cards instead of drawing bars", async () => {
    route({ stats: stats({ skills: [], memory: [], hasSkillsAttached: false, skillsTrackingSince: null, memoryTrackingSince: null }) });
    mount();
    expect(await screen.findByText("No skills attached to this agent")).toBeInTheDocument();
    expect(screen.getByText("No memory pulled in this period")).toBeInTheDocument();
  });

  it("an agent with skills but no usage in the period says so", async () => {
    route({ stats: stats({ skills: [], skillsTrackingSince: null }) });
    mount();
    expect(await screen.findByText("No skill usage recorded in this period")).toBeInTheDocument();
  });

  it("draws one severity column per bucket and states the finding count", async () => {
    route();
    mount();
    await screen.findByTestId("kpi-runs");
    expect(screen.getAllByTestId("stacked-bar-column")).toHaveLength(5);
    expect(screen.getByTestId("severity-caption")).toHaveTextContent("48 findings in period");
    expect(screen.getAllByTestId("stacked-bar-column")[4]).toHaveAttribute("title", expect.stringMatching(/^W5: .* – now · partial$/));
  });

  it("shows all five categories with counts and no currency sign", async () => {
    route();
    mount();
    await screen.findByTestId("kpi-runs");
    for (const text of ["24 · 50%", "12 · 25%", "6 · 13%", "4 · 8%", "2 · 4%"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText("Findings by category").closest("div")!.parentElement!.textContent).not.toContain("$");
  });
});

describe("run history", () => {
  it("asks for 10 rows first and renders local, failed, CI and legacy-CI rows correctly", async () => {
    route({
      pages: [
        {
          items: [
            run({ id: "local", hasTrace: true }),
            run({ id: "failed", status: "failed", error: "quota exceeded", hasTrace: false, tokensIn: null, tokensOut: null, costUsd: null, costSource: null, findingsCount: null }),
            run({
              id: "ci",
              source: "ci",
              hasTrace: false,
              pr: { number: 42, repoId: null, githubUrl: "https://github.com/acme/web/pull/42" },
              ciRunUrl: "https://github.com/acme/web/actions/runs/1",
              tokensIn: null,
              tokensOut: null,
              costSource: null,
            }),
            run({ id: "legacy", source: "ci", hasTrace: false, pr: null, ciRunUrl: null, costSource: null }),
          ],
          nextCursor: null,
        },
      ],
    });
    mount();
    await screen.findAllByTestId("run-row");
    expect(urls().find((u) => u.includes("/runs?"))).toMatch(/limit=10/);

    const row = (id: string) => screen.getAllByTestId("run-row").find((r) => r.getAttribute("data-run") === id)!;
    // local: PR links into the app, tokens abbreviated, billed source, a trace to open
    expect(within(row("local")).getByRole("link", { name: "#482" })).toHaveAttribute("href", "/repos/repo-1/pulls/482");
    expect(within(row("local")).getByText("16k")).toBeInTheDocument();
    expect(within(row("local")).getByText("billed")).toBeInTheDocument();
    expect(within(row("local")).getByRole("button", { name: "View trace" })).toBeInTheDocument();
    // failed: an icon whose tooltip is the error; missing values are dashes
    expect(within(row("failed")).getByTestId("run-failed")).toHaveAttribute("title", "quota exceeded");
    expect(within(row("failed")).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(within(row("failed")).queryByRole("button", { name: "View trace" })).toBeNull();
    // CI: GitHub PR link, CI badge, an Open in GitHub link instead of a trace
    expect(within(row("ci")).getByRole("link", { name: "#42" })).toHaveAttribute("href", "https://github.com/acme/web/pull/42");
    expect(within(row("ci")).getByText("CI")).toBeInTheDocument();
    expect(within(row("ci")).getByRole("link", { name: "Open in GitHub" })).toHaveAttribute("href", "https://github.com/acme/web/actions/runs/1");
    expect(within(row("ci")).queryByRole("button", { name: "View trace" })).toBeNull();
    // legacy CI row: nothing to link to, so nothing is offered
    expect(within(row("legacy")).queryByRole("link")).toBeNull();
    expect(within(row("legacy")).queryByRole("button")).toBeNull();
  });

  it("loads the next page when the 5th row from the end scrolls into view, without duplicates", async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => run({ id: `a${i}` }));
    route({ pages: [{ items: page1, nextCursor: "CUR" }, { items: [run({ id: "b0" })], nextCursor: null }] });
    mount();
    await screen.findAllByTestId("run-row");
    expect(screen.getAllByTestId("run-row")).toHaveLength(10);
    // the observed node is exactly the 5th row from the end
    expect(observed.at(-1)).toBe(screen.getAllByTestId("run-row")[5]);
    await act(async () => intersect?.([{ isIntersecting: true }]));
    await waitFor(() => expect(screen.getAllByTestId("run-row")).toHaveLength(11));
    expect(urls().filter((u) => u.includes("cursor=CUR"))).toHaveLength(1);
    const ids = screen.getAllByTestId("run-row").map((r) => r.getAttribute("data-run"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not observe anything when there is no further page", async () => {
    route();
    mount();
    await screen.findAllByTestId("run-row");
    expect(observed).toHaveLength(0);
  });

  it("says so when the period has no runs in the history", async () => {
    route({ pages: [{ items: [], nextCursor: null }] });
    mount();
    expect(await screen.findAllByText("No runs in this period")).not.toHaveLength(0);
  });

  it("opens the trace drawer and loads that run's findings with exactly one GET", async () => {
    route();
    mount();
    await screen.findAllByTestId("run-row");
    expect(urls().some((u) => u.includes("/findings"))).toBe(false); // not before the drawer opens
    fireEvent.click(screen.getByRole("button", { name: "View trace" }));
    const drawer = await screen.findByTestId("trace-drawer");
    expect(drawer).toHaveAttribute("data-run", "r1");
    await waitFor(() => expect(drawer).toHaveAttribute("data-findings", "2"));
    expect(urls().filter((u) => u.endsWith("/runs/r1/findings"))).toHaveLength(1);
    fireEvent.click(within(drawer).getByText("close"));
    expect(screen.queryByTestId("trace-drawer")).toBeNull();
  });
});

describe("read-only", () => {
  it("only ever issues GET requests", async () => {
    route();
    mount();
    await screen.findAllByTestId("run-row");
    fireEvent.click(screen.getByRole("button", { name: "View trace" }));
    await screen.findByTestId("trace-drawer");
    expect(methods().every((m) => m === "GET")).toBe(true);
  });

  it("shows the Sync CI button only when the workspace has a CI installation", async () => {
    route({ stats: stats({ hasCiInstallations: false }) });
    const off = mount();
    await screen.findByTestId("kpi-runs");
    expect(screen.queryByRole("button", { name: /Sync CI/ })).toBeNull();
    off.unmount();
    route({ stats: stats({ hasCiInstallations: true }) });
    mount();
    expect(await screen.findByRole("button", { name: /Sync CI/ })).toBeInTheDocument();
  });
});
