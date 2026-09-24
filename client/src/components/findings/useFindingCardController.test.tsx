import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord } from "@devdigest/shared";
import type React from "react";

const actionMutate = vi.fn();
const postCommentMutate = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: actionMutate, isPending: false, variables: undefined }),
  useCreatePrComment: () => ({ mutate: postCommentMutate, isPending: false }),
}));

const prefillMutate = vi.fn();
vi.mock("@/lib/hooks/evals", () => ({
  usePrefillEvalCase: () => ({ mutate: prefillMutate, isPending: false }),
}));

import { useFindingCardController } from "./useFindingCardController";

afterEach(() => {
  vi.clearAllMocks();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useFindingCardController", () => {
  it("a reply action also posts a PR comment", () => {
    const { result } = renderHook(() => useFindingCardController("pr1"), { wrapper });
    result.current.onAction(FINDING)("reply", { reply: "Thanks!" });

    expect(actionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ findingId: "f1", action: "reply", reply: "Thanks!", prId: "pr1" }),
      undefined,
    );
    expect(postCommentMutate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/config.ts", line: 11, body: "Thanks!" }),
      undefined,
    );
  });

  it("a non-reply action does not post a PR comment", () => {
    const { result } = renderHook(() => useFindingCardController("pr1"), { wrapper });
    result.current.onAction(FINDING)("accept");

    expect(actionMutate).toHaveBeenCalled();
    expect(postCommentMutate).not.toHaveBeenCalled();
  });

  it("forwards onError to every mutation", () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useFindingCardController("pr1", { onError }), {
      wrapper,
    });

    result.current.onAction(FINDING)("reply", { reply: "hi" });
    expect(actionMutate).toHaveBeenCalledWith(expect.anything(), { onError });
    expect(postCommentMutate).toHaveBeenCalledWith(expect.anything(), { onError });

    result.current.onCreateEvalCase(FINDING);
    expect(prefillMutate).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({ onError }),
    );
  });
});
