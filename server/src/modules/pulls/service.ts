/** PullsService — assembles SmartDiff for a PR.
 *  Zero LLM calls: reads only from the DB via ReviewRepository. */

import type { SmartDiff } from "@devdigest/shared";
import { NotFoundError } from "../../platform/errors.js";
import type { ReviewRepository } from "../reviews/repository.js";
import { buildSmartDiff } from "./classifier.js";

export class PullsService {
  constructor(private reviewRepo: ReviewRepository) {}

  async buildSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const [pr, prFiles, latestReviewData] = await Promise.all([
      this.reviewRepo.getPull(workspaceId, prId),
      this.reviewRepo.getPrFiles(prId),
      this.reviewRepo.getLatestReviewData(prId),
    ]);

    if (!pr) throw new NotFoundError("Pull request not found");

    // Group files by classifier role (no DB, pure CPU).
    const base = buildSmartDiff(prFiles);

    // Union findings across all latest-per-agent results (AC-52/53).
    // AC-54: filter out dismissed findings; suppress accepted ones from line badges
    // so the diff stays clean for already-actioned items.
    const allFindings = latestReviewData
      .flatMap((r) => r.findings)
      .filter((f) => !f.dismissedAt); // dismissed → hide entirely
    const reviewTokens =
      latestReviewData.find((r) => r.reviewTokens !== null)?.reviewTokens ??
      null;

    // Build per-file index from review findings.
    const findingsByFile = new Map<string, typeof allFindings>();
    for (const f of allFindings) {
      const list = findingsByFile.get(f.file) ?? [];
      list.push(f);
      findingsByFile.set(f.file, list);
    }

    const hasReview = allFindings.length > 0 || reviewTokens !== null;

    // Enrich each file with finding_lines + severity_counts + line_findings from latest review.
    const enrichedGroups = base.groups.map((group) => ({
      ...group,
      files: group.files.map((file) => {
        const findings = findingsByFile.get(file.path) ?? [];
        // Pick the most severe badge per line (critical > warning > suggestion).
        const severityRank: Record<string, number> = {
          CRITICAL: 3,
          WARNING: 2,
          SUGGESTION: 1,
        };
        // AC-54: accepted findings are suppressed from line badges (shown as
        // "accepted" colour in the diff gutter, not as active warnings).
        const activeFindings = findings.filter((f) => !f.acceptedAt);
        const lineMap = new Map<number, { severity: string; id: string; accepted: boolean }>();
        for (const f of findings) {
          const isAccepted = !!f.acceptedAt;
          const existing = lineMap.get(f.startLine);
          const rank = isAccepted ? 0 : (severityRank[f.severity] ?? 0);
          const existingRank = existing
            ? existing.accepted
              ? 0
              : (severityRank[existing.severity] ?? 0)
            : -1;
          if (!existing || rank > existingRank) {
            lineMap.set(f.startLine, { severity: f.severity, id: f.id, accepted: isAccepted });
          }
        }
        return {
          ...file,
          finding_lines: [...new Set(activeFindings.map((f) => f.startLine))].sort(
            (a, b) => a - b,
          ),
          severity_counts: hasReview
            ? {
                critical: activeFindings.filter((f) => f.severity === "CRITICAL")
                  .length,
                warning: activeFindings.filter((f) => f.severity === "WARNING")
                  .length,
                suggestion: activeFindings.filter((f) => f.severity === "SUGGESTION")
                  .length,
              }
            : null,
          line_findings: hasReview
            ? [...lineMap.entries()].map(([line, { severity, id, accepted }]) => ({
                id,
                line,
                severity,
                accepted,
              }))
            : null,
        };
      }),
    }));

    return {
      ...base,
      groups: enrichedGroups,
      review_tokens: reviewTokens,
    };
  }
}
