/* InlineFindingCard — the shared Findings-tab `FindingCard`, reused as-is,
 * wired the same way `FindingsPanel` wires it (via `useFindingCardController`)
 * plus an error toast for inline actions (R27) and its own `EvalCaseModal`
 * mount ("Turn into eval case", R22). No optimistic updates: state changes
 * only via the next smart-diff refetch (AC-23..25 rely on `useFindingAction`'s
 * `["smart-diff", prId]` invalidation). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "@/components/findings/FindingCard";
import { useFindingCardController } from "@/components/findings/useFindingCardController";
import { EvalCaseModal } from "@/components/evals/EvalCaseModal";
import { notify } from "@/lib/contexts/toast";
import type { DiffFindingsApi } from "../findings";

export function InlineFindingCard({
  f,
  api,
}: {
  f: FindingRecord;
  api: DiffFindingsApi;
}) {
  const t = useTranslations("prReview.finding");
  const c = useFindingCardController(api.prId, {
    onError: () => notify.error(t("actionFailed")),
  });

  return (
    <>
      <FindingCard
        f={f}
        defaultExpanded
        pending={c.isPending(f.id)}
        repo={api.repo}
        headSha={api.headSha}
        onAction={c.onAction(f)}
        onCreateEvalCase={c.onCreateEvalCase}
      />
      {c.evalPrefill && (
        <EvalCaseModal prefill={c.evalPrefill} onClose={c.closeEval} />
      )}
    </>
  );
}
