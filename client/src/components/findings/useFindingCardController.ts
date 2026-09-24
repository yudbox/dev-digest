/* useFindingCardController — centralises the FindingCard wiring shared by
   FindingsPanel (Findings tab) and InlineFindingCard (Files changed tab), so
   the two surfaces cannot drift: same mutation, same pending check, same
   reply → PR-comment side effect, same eval-case prefill flow. Behaviour is
   moved unchanged from FindingsPanel; the only addition is an optional
   `onError` (used by the inline card only — R27). */
"use client";

import React from "react";
import type {
  FindingRecord,
  FindingActionKind,
  EvalCaseInput,
} from "@devdigest/shared";
import { useFindingAction, useCreatePrComment } from "@/lib/hooks/reviews";
import { usePrefillEvalCase } from "@/lib/hooks/evals";

export interface UseFindingCardControllerOptions {
  /** Called when a mutation (action, reply→comment, or eval prefill) fails.
   *  The Findings tab passes nothing (unchanged behaviour); the inline card
   *  passes a toast (R27). */
  onError?: (err: unknown) => void;
}

export function useFindingCardController(
  prId: string | null | undefined,
  options: UseFindingCardControllerOptions = {},
) {
  const action = useFindingAction();
  const postComment = useCreatePrComment(prId);
  const prefillEvalCase = usePrefillEvalCase();
  const [evalPrefill, setEvalPrefill] = React.useState<EvalCaseInput | null>(
    null,
  );

  const onAction =
    (f: FindingRecord) =>
    (act: FindingActionKind, extra?: { note?: string; reply?: string }) => {
      action.mutate(
        {
          findingId: f.id,
          action: act,
          prId: prId ?? undefined,
          note: extra?.note,
          reply: extra?.reply,
        },
        options.onError ? { onError: options.onError } : undefined,
      );
      // AC-37 (pre-existing behaviour): post inline GitHub comment when the
      // user replies to the author, in addition to persisting the reply.
      if (act === "reply" && extra?.reply) {
        postComment.mutate(
          { path: f.file, line: f.start_line, body: extra.reply },
          options.onError ? { onError: options.onError } : undefined,
        );
      }
    };

  const isPending = (id: string): boolean =>
    action.isPending && action.variables?.findingId === id;

  const onCreateEvalCase = (f: FindingRecord): void => {
    prefillEvalCase.mutate(f.id, {
      onSuccess: (input) => setEvalPrefill(input),
      ...(options.onError ? { onError: options.onError } : {}),
    });
  };

  const closeEval = (): void => setEvalPrefill(null);

  return { onAction, isPending, onCreateEvalCase, evalPrefill, closeEval };
}
