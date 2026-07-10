import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import evalMessages from "../../../../../../messages/en/eval.json";

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: [], isLoading: false }),
  useEvalDashboard: () => ({ data: undefined }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useRunAgentEvals: () => ({ mutate: vi.fn(), isPending: false }),
  useRunSkillEvals: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SkillEditor } from "./SkillEditor";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "Checks PR quality",
  type: "rubric",
  source: "manual",
  body: "# Rule\nBe concise.",
  enabled: true,
  version: 1,
  evidence_files: null,
  context_doc_paths: [],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor Evals tab (AC-23/28)", () => {
  it("renders the Evals tab without an invalid-tab fallback, and without agent-only affordances", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="evals" onTab={() => {}} />);
    expect(screen.getByText("Eval cases")).toBeInTheDocument();
    expect(screen.queryByText("View full dashboard →")).not.toBeInTheDocument();
    expect(screen.queryByText(/promote/i)).not.toBeInTheDocument();
  });
});
