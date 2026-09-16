"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, EmptyState } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "@/components/smart-diff/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/pulls";
import { notify } from "@/lib/contexts/toast";
import type { PrFile, DiffUnavailable } from "@devdigest/shared";

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
}

export function DiffTab({
  prId,
  filesCount,
  files,
  diffUnavailable,
  canComment,
  smartOrder,
  onSmartOrderChange,
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
  const smartDiff = useSmartDiff(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const setSmartOrder = onSmartOrderChange;

  const commentCount = comments?.length ?? 0;

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
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} (
                {commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
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
