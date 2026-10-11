import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: { method: string; url: string }[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({ method: init?.method ?? "GET", url });
  const u = new URL(url);
  let body: unknown = {};
  if (u.pathname === "/agents/a1/runs") {
    body = u.searchParams.get("cursor")
      ? { items: [{ id: "r2" }], nextCursor: null }
      : { items: [{ id: "r1" }], nextCursor: "CUR" };
  } else if (u.pathname === "/ci-runs/refresh") {
    body = { synced_at: "now", ingested: 3, installations_checked: 1 };
  }
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
});

import { PeriodProvider, usePeriod } from "../contexts/periodContext";
import { useAgentPerformance, useAgentRuns, useAgentStats, useRunFindings, useSyncCi } from "./performance";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <PeriodProvider>{children}</PeriodProvider>
    </QueryClientProvider>
  );
  return { wrapper, invalidate };
}

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockClear();
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("stats hooks", () => {
  it("send the period as a query and only ever GET", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ perf: useAgentPerformance(), stats: useAgentStats("a1"), period: usePeriod() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.perf.isSuccess && result.current.stats.isSuccess).toBe(true));
    expect(calls.map((c) => c.method)).toEqual(expect.arrayContaining(["GET"]));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => /\/agent-performance\?range=30d&tz=/.test(c.url))).toBe(true);
    expect(calls.some((c) => /\/agents\/a1\/stats\?range=30d&tz=/.test(c.url))).toBe(true);
  });

  it("refetch with the new period when it changes (period is part of the cache key)", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ perf: useAgentPerformance(), period: usePeriod() }), { wrapper });
    await waitFor(() => expect(result.current.perf.isSuccess).toBe(true));
    act(() => result.current.period.setPeriod({ kind: "1d" }));
    await waitFor(() => expect(calls.some((c) => /\/agent-performance\?range=1d/.test(c.url))).toBe(true));
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("do not fire until the stored period has been read, and not without an id", async () => {
    const { wrapper } = setup();
    renderHook(() => useAgentStats(undefined), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it("uses the stored period for the very first request (no default-period request first)", async () => {
    localStorage.setItem("dd-period", JSON.stringify({ kind: "1d" }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useAgentPerformance(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("range=1d");
  });

  it("useAgentRuns pages by cursor, 10 at a time", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAgentRuns("a1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]!.url).toMatch(/limit=10/);
    expect(calls[0]!.url).not.toMatch(/cursor=/);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data!.pages).toHaveLength(2));
    expect(calls.at(-1)!.url).toMatch(/cursor=CUR/);
    expect(result.current.data!.pages.flatMap((p) => p.items.map((i) => (i as { id: string }).id))).toEqual(["r1", "r2"]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("useRunFindings stays idle until enabled", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ on }) => useRunFindings("run1", on), {
      wrapper,
      initialProps: { on: false },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    rerender({ on: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.filter((c) => c.url.endsWith("/runs/run1/findings"))).toHaveLength(1);
  });
});

describe("useSyncCi", () => {
  it("POSTs the existing CI refresh once and invalidates every stats query", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useSyncCi(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toMatch(/\/ci-runs\/refresh$/);
    for (const key of ["agent-performance", "agent-stats", "agent-runs", "skill-stats", "ci-runs"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    await waitFor(() => expect(result.current.data?.ingested).toBe(3));
  });
});
