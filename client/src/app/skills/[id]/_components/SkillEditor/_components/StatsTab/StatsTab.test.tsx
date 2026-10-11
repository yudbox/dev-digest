import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillStatsResponse } from "@devdigest/shared";
import statsMessages from "@messages/en/stats.json";
import skillsMessages from "@messages/en/skills.json";
import { PeriodProvider } from "@/lib/contexts/periodContext";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { StatsTab } from "./StatsTab";

const fetchMock = vi.fn();

const window30 = {
  kind: "30d" as const,
  from: "2026-09-11T09:22:00.000Z",
  to: "2026-10-11T09:22:00.000Z",
  tz: "UTC",
  days: 30,
  bucketKind: "week" as const,
  buckets: [],
  previous: { from: "2026-08-12T09:22:00.000Z", to: "2026-09-11T09:22:00.000Z" },
};

function stats(over: Partial<SkillStatsResponse> = {}): SkillStatsResponse {
  return {
    window: window30,
    hasAnyRuns: true,
    loadedRunsInWindow: 30,
    usedBy: 3,
    ranInPeriod: 2,
    pullFrequency: { prsApplied: 12, prsLoaded: 17 },
    accept: { accepted: 14, resolved: 19 },
    findings: 96,
    categories: [
      { category: "security", count: 52 },
      { category: "bug", count: 20 },
      { category: "perf", count: 16 },
      { category: "style", count: 8 },
      { category: "test", count: 0 },
    ],
    agents: [
      { id: "a1", name: "Security Reviewer", enabled: true },
      { id: "a2", name: "Performance Reviewer", enabled: true },
      { id: "a3", name: "Custom Mentor", enabled: false },
    ],
    ...over,
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ stats: statsMessages, skills: skillsMessages }}>
      <QueryClientProvider client={qc}>
        <PeriodProvider>
          <StatsTab skillId="sk1" />
        </PeriodProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const methods = () => fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? "GET");

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.restoreAllMocks());

describe("states", () => {
  it("loading: skeleton only, no digits", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    mount();
    expect(await screen.findByTestId("stats-skeleton")).toHaveTextContent("");
    expect(screen.queryByTestId("kpi-used-by")).toBeNull();
  });

  it("error: Retry and no numbers", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "x", json: async () => ({}) } as Response);
    mount();
    expect((await screen.findByRole("alert")).textContent).not.toMatch(/\d/);
    fetchMock.mockResolvedValue(ok(stats()));
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await screen.findByTestId("kpi-used-by");
  });

  it("attached to no agent: the 'No usage yet' empty state, text only", async () => {
    fetchMock.mockResolvedValue(ok(stats({ usedBy: 0, agents: [], hasAnyRuns: false, loadedRunsInWindow: 0 })));
    mount();
    const empty = await screen.findByTestId("skill-no-usage");
    expect(within(empty).getByText("No usage yet")).toBeInTheDocument();
    expect(within(empty).getByText(/isn't enabled on any agent/)).toBeInTheDocument();
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(empty.querySelector("a")).toBeNull();
  });

  it("attached but never run with the skill loaded: says so, and still lists the agents", async () => {
    fetchMock.mockResolvedValue(ok(stats({ hasAnyRuns: false, loadedRunsInWindow: 0 })));
    mount();
    expect(await screen.findByTestId("skill-never-ran")).toHaveTextContent("This skill hasn't run yet");
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-used-by")).toBeNull();
  });

  it("runs exist but none in the period: keeps the selector and the agent list", async () => {
    fetchMock.mockResolvedValue(ok(stats({ loadedRunsInWindow: 0 })));
    mount();
    const empty = await screen.findByTestId("skill-no-runs");
    expect(within(empty).getByText("No runs in this period")).toBeInTheDocument();
    expect(within(empty).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByTestId("agents-using")).toBeInTheDocument();
  });
});

describe("KPIs", () => {
  it("shows used-by (with who ran in the period), pull frequency with its denominator, accept rate and findings", async () => {
    fetchMock.mockResolvedValue(ok(stats()));
    const { container } = mount();
    await screen.findByTestId("kpi-used-by");
    const usedBy = screen.getByTestId("kpi-used-by");
    expect(within(usedBy).getByText("3 agents")).toBeInTheDocument();
    expect(within(usedBy).getByText("2 ran in period")).toBeInTheDocument();
    const pull = screen.getByTestId("kpi-pull");
    expect(within(pull).getByText("71% (12/17 PRs)")).toBeInTheDocument();
    expect(within(pull).getByText("local runs")).toBeInTheDocument();
    const accept = screen.getByTestId("kpi-accept");
    expect(within(accept).getByText("74% (14/19)")).toBeInTheDocument();
    expect(within(accept).getByText("based on 96 local findings")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-findings")).getByText("96")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/30D/i);
  });

  it("says '1 agent' in the singular", async () => {
    fetchMock.mockResolvedValue(ok(stats({ usedBy: 1, agents: [{ id: "a1", name: "Solo", enabled: true }] })));
    mount();
    expect(await screen.findByText("1 agent")).toBeInTheDocument();
  });

  it("shows dashes, never 0%, when there is nothing to compute from", async () => {
    fetchMock.mockResolvedValue(ok(stats({ pullFrequency: { prsApplied: 0, prsLoaded: 0 }, accept: { accepted: 0, resolved: 0 }, findings: 0 })));
    mount();
    await screen.findByTestId("kpi-pull");
    expect(within(screen.getByTestId("kpi-pull")).getByText("—")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-accept")).getByTestId("accept-value")).toHaveTextContent("—");
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("flags a small accept sample", async () => {
    fetchMock.mockResolvedValue(ok(stats({ accept: { accepted: 3, resolved: 4 } })));
    mount();
    await screen.findByTestId("kpi-accept");
    expect(within(screen.getByTestId("kpi-accept")).getByTestId("small-sample-badge")).toBeInTheDocument();
  });
});

describe("agents using this skill", () => {
  it("lists them by name, mutes disabled ones, and Open goes to that agent's Stats tab", async () => {
    fetchMock.mockResolvedValue(ok(stats()));
    mount();
    await screen.findByTestId("agents-using");
    const rows = screen.getAllByTestId("agent-using-row");
    expect(rows.map((r) => r.getAttribute("data-agent"))).toEqual(["Security Reviewer", "Performance Reviewer", "Custom Mentor"]);
    const mentor = rows.find((r) => r.getAttribute("data-agent") === "Custom Mentor")!;
    expect(within(mentor).getByText("disabled")).toBeInTheDocument();
    expect(within(rows[0]!).queryByText("disabled")).toBeNull();
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Open" }));
    expect(push).toHaveBeenCalledWith("/agents/a2?tab=stats");
  });
});

describe("findings by category", () => {
  it("shows all five categories, and the middle of the ring equals the Findings card", async () => {
    fetchMock.mockResolvedValue(ok(stats({ findings: 96 })));
    const { container } = mount();
    await screen.findByTestId("kpi-findings");
    for (const text of ["52 · 54%", "20 · 21%", "16 · 17%", "8 · 8%", "0 · 0%"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByTestId("donut-center")).toHaveTextContent("96");
    expect(container.textContent).not.toContain("$");
  });
});

describe("read-only", () => {
  it("requests the period (no suffix, only GETs) and never writes", async () => {
    fetchMock.mockResolvedValue(ok(stats()));
    mount();
    await screen.findByTestId("kpi-used-by");
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/skills\/sk1\/stats\?range=30d&tz=/);
    expect(methods().every((m) => m === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(screen.getByText("1 day"));
    await screen.findByTestId("kpi-used-by");
    expect(fetchMock.mock.calls.some((c) => /range=1d/.test(String(c[0])))).toBe(true);
    expect(methods().every((m) => m === "GET")).toBe(true);
  });
});
