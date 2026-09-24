import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";

vi.mock("../api", () => ({
  api: {
    post: vi.fn().mockResolvedValue({ finding: { id: "f1" } }),
  },
  API_BASE: "http://localhost:3001",
}));

import { useFindingAction } from "./reviews";

describe("useFindingAction (AC-26)", () => {
  it("invalidates both ['reviews', prId] and ['smart-diff', prId] after a successful action", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useFindingAction(), { wrapper });
    result.current.mutate({ findingId: "f1", action: "accept", prId: "pr1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["reviews", "pr1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["smart-diff", "pr1"] });
  });
});
