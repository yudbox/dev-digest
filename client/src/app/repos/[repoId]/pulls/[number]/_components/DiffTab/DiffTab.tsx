"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, EmptyState } from "@devdigest/ui";
import {
  DiffViewer,
  indexLineFindings,
  type DiffCommentApi,
  type DiffFindingsApi,
} from "@/components/diff-viewer";
import { SmartDiffViewer } from "@/components/smart-diff/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/pulls";
import { notify } from "@/lib/contexts/toast";
import type { PrFile, DiffUnavailable } from "@devdigest/shared";
import type { VcsUrlRepo } from "@/lib/utils/vcsUrls";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Set only when the diff couldn't be computed locally (Azure DevOps
   * diff-first path) — GitHub PRs never set this. */
  diffUnavailable?: DiffUnavailable | null;
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  smartOrder: boolean;
  onSmartOrderChange: (v: boolean) => void;
  /** Needed to build VCS file:line links inside inline finding cards (AC-22). */
  repo?: VcsUrlRepo | null;
  headSha?: string | null;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  diffUnavailable,
  canComment,
  smartOrder,
  onSmartOrderChange,
  repo,
  headSha,
}: DiffTabProps) {
  const t = useTranslations("prReview.smartDiff");
  const tDiffUnavailable = useTranslations("prReview.diffUnavailable");
  const searchParams = useSearchParams();
  const targetFile = searchParams.get("file") ?? undefined;
  const targetLine = searchParams.get("line")
    ? Number(searchParams.get("line"))
    : undefined;
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Single source of truth for ALL finding UI in the diff (AC-31) — the
  // Files-changed tab never requests GET /pulls/:id/reviews / usePrReviews.
  const smartDiff = useSmartDiff(prId);
  // ONE Show/Hide switch for GitHub comment threads AND inline finding
  // annotations (row tint, markers, cards, "outside the diff" block), so the
  // diff can be made clean in one click. Shown by default so a finished review
  // is visible right away; the file dot / chips / group counter never hide.
  const [showComments, setShowComments] = React.useState(true);
  const setSmartOrder = onSmartOrderChange;

  // Finding UI (markers, dots, chips, inline cards) is a Smart-order feature
  // only — Original order is the plain diff. `undefined` while smart-diff is
  // pending/failed, which also falls back to the plain Original diff (AC-34).
  const findings: DiffFindingsApi | undefined = React.useMemo(() => {
    if (!smartDiff.data || !prId) return undefined;
    return {
      prId,
      byFile: indexLineFindings(smartDiff.data),
      repo,
      headSha,
      showInline: showComments,
      onRevealInline: () => setShowComments(true),
    };
  }, [smartDiff.data, prId, repo, headSha, showComments]);

  const commentCount = comments?.length ?? 0;
  // Findings only render in Smart order, so only count them there.
  const findingCount =
    smartOrder && findings
      ? [...findings.byFile.values()].reduce((n, list) => n + list.length, 0)
      : 0;
  const toggleLabel = [
    commentCount > 0 ? t("toggleComments", { count: commentCount }) : null,
    findingCount > 0 ? t("toggleFindings", { count: findingCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(
          err instanceof Error
            ? err.message
            : "Couldn't post the comment to GitHub.",
        );
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {smartDiff.data && (
              <>
                <Button
                  kind={smartOrder ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setSmartOrder(true)}
                >
                  {t("smartOrder")}
                </Button>
                <Button
                  kind={!smartOrder ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setSmartOrder(false)}
                >
                  {t("originalOrder")}
                </Button>
              </>
            )}
            {(commentCount > 0 || findingCount > 0) && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments
                  ? t("toggleHide", { items: toggleLabel })
                  : t("toggleShow", { items: toggleLabel })}
              </Button>
            )}
          </div>
        }
      >
        {t("filesChangedTitle", { count: filesCount })}
      </SectionLabel>
      {diffUnavailable ? (
        <EmptyState
          icon="AlertTriangle"
          title={tDiffUnavailable("title")}
          body={tDiffUnavailable(diffUnavailable.reason)}
        />
      ) : smartOrder && smartDiff.data ? (
        <SmartDiffViewer
          smartDiff={smartDiff.data}
          files={files}
          commenting={commenting}
          findings={findings}
          targetFile={targetFile}
          targetLine={targetLine}
        />
      ) : (
        <DiffViewer
          files={files}
          commenting={commenting}
          targetFile={targetFile}
          targetLine={targetLine}
        />
      )}
    </section>
  );
}
