/** PullsService — assembles SmartDiff for a PR.
 *  Zero LLM calls: reads only from the DB via ReviewRepository. */

import type { SmartDiff } from "@devdigest/shared";
import { FindingRecord } from "@devdigest/shared";
import { NotFoundError } from "../../platform/errors.js";
import type { ReviewRepository } from "../reviews/repository.js";
import { findingRowToDto } from "../reviews/service.js";
import { buildSmartDiff } from "./classifier.js";

/** Severity rank used only to order `line_findings` within a file
 *  (critical first) — this is display ordering, not a filter. */
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

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

    // AC-10: "a review has run" means at least one agent has a latest review
    // for this PR — NOT "there is at least one finding" (a clean review with
    // 0 findings must still return `[]`, not `null`, for every file).
    const hasReview = latestReviewData.length > 0;

    // Union findings across all latest-per-agent results (AC-10), excluding
    // dismissed ones. Accepted findings ARE included (with their accepted
    // state) — no per-line reduction, every finding is kept.
    const allFindings = latestReviewData
      .flatMap((r) => r.findings)
      .filter((f) => !f.dismissedAt);
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

    // Enrich each file with the full `line_findings` from the latest review.
    const enrichedGroups = base.groups.map((group) => ({
      ...group,
      files: group.files.map((file) => {
        const findings = findingsByFile.get(file.path) ?? [];
        const lineFindings: FindingRecord[] | null = hasReview
          ? [...findings]
              .sort((a, b) => {
                if (a.startLine !== b.startLine) return a.startLine - b.startLine;
                const rankDiff =
                  (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
                if (rankDiff !== 0) return rankDiff;
                return a.id.localeCompare(b.id);
              })
              // Validated + stripped through the FindingRecord response
              // schema (drops server-only fields like `replied_at`).
              .map((f) => FindingRecord.parse(findingRowToDto(f)))
          : null;
        return {
          ...file,
          line_findings: lineFindings,
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
