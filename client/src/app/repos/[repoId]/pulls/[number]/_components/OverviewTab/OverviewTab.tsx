"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import {
  usePullIntent,
  useRecalculateIntent,
  useBlastRadius,
  useBrief,
  useRegenerateBrief,
} from "@/lib/hooks/pulls";
import { usePrRuns, usePrReviews } from "@/lib/hooks/reviews";
import type { RunSummary } from "@devdigest/shared";
import type { VcsUrlRepo } from "@/lib/utils/vcsUrls";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { BriefCard } from "../BriefCard";
import { ReviewFocusList } from "../BriefCard/ReviewFocusList";
import { ErrorBoundary } from "react-error-boundary";
import { s } from "./styles";
import type { CSSProperties } from "react";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
  /** Repo + PR head sha — used to deep-link blast-radius callers to the VCS. */
  repo?: VcsUrlRepo | null;
  headSha?: string | null;
}

export function OverviewTab({ prBody, prId, repo, headSha }: OverviewTabProps) {
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const router = useRouter();
  const { data: intent, isLoading } = usePullIntent(prId);
  const recalc = useRecalculateIntent(prId);
  const { data: blastRadius, isLoading: blastLoading } = useBlastRadius(prId);

  const {
    data: brief,
    isLoading: briefLoading,
    isError: briefError,
  } = useBrief(prId);
  const regenerateBrief = useRegenerateBrief(prId);
  const { data: runs } = usePrRuns(prId);
  const latestDoneRun =
    runs?.find((r: RunSummary) => r.status === "done") ?? null;
  const { data: reviews } = usePrReviews(prId);
  const latestReview = reviews?.[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* PR Brief — full width */}
      <section>
        <SectionLabel icon="FileText">PR Brief</SectionLabel>
        <ErrorBoundary
          fallback={
            <div style={{ fontSize: 13, color: "var(--crit)", padding: 12 }}>
              Failed to load PR Brief
            </div>
          }
        >
          <BriefCard
            brief={brief}
            isLoading={briefLoading}
            isError={briefError}
            latestRun={latestDoneRun}
            latestReview={latestReview}
            prId={prId ?? ""}
            repoId={repoId}
            prNumber={number}
            onRegenerate={() => regenerateBrief.mutate()}
            regenerating={regenerateBrief.isPending}
          />
        </ErrorBoundary>
      </section>

      {/* 2-column: Intent + Blast Radius */}
      <div
        style={
          {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignItems: "start",
          } satisfies CSSProperties
        }
      >
        <IntentCard
          intent={intent}
          isLoading={isLoading}
          onRecalculate={() => recalc.mutate()}
          recalculating={recalc.isPending}
          risks={brief?.risks}
        />
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            height: 700,
            minWidth: 0,
          }}
        >
          <SectionLabel icon="GitPullRequest">Blast Radius</SectionLabel>
          <ErrorBoundary
            fallback={
              <div className="text-sm text-red-400 p-4">
                Failed to load blast radius
              </div>
            }
          >
            <BlastRadiusCard
              blastRadius={blastRadius}
              isLoading={blastLoading}
              repo={repo}
              headSha={headSha}
              className="flex-1 overflow-y-auto"
            />
          </ErrorBoundary>
        </section>
      </div>

      {/* Review Focus — full width, first */}
      {brief?.review_focus && brief.review_focus.length > 0 && (
        <section>
          <ReviewFocusList
            items={brief.review_focus}
            onNavigate={(ref) => {
              const colonIdx = ref.lastIndexOf(":");
              const hasLine = colonIdx > 0 && colonIdx > ref.lastIndexOf("/");
              const filePath = hasLine ? ref.slice(0, colonIdx) : ref;
              const lineStr = hasLine
                ? ref.slice(colonIdx + 1).split("-")[0]
                : undefined;
              router.push(
                `/repos/${repoId}/pulls/${number}?tab=diff&file=${encodeURIComponent(filePath)}${lineStr ? `&line=${lineStr}` : ""}`,
              );
            }}
          />
        </section>
      )}

      {/* PR Description — below Review Focus */}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
