/** PullsService — assembles SmartDiff for a PR.
 *  Zero LLM calls: reads only from the DB via ReviewRepository. */

import type { SmartDiff } from "@devdigest/shared";
import { NotFoundError } from "../../platform/errors.js";
import type { ReviewRepository } from "../reviews/repository.js";
import { buildSmartDiff } from "./classifier.js";

export class PullsService {
  constructor(private reviewRepo: ReviewRepository) {}

  async buildSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const [pr, prFiles, latestReview] = await Promise.all([
      this.reviewRepo.getPull(workspaceId, prId),
      this.reviewRepo.getPrFiles(prId),
      this.reviewRepo.getLatestReviewData(prId),
    ]);

    if (!pr) throw new NotFoundError("Pull request not found");

    // Group files by classifier role (no DB, pure CPU).
    const base = buildSmartDiff(prFiles);

    // Build per-file index from review findings.
    const findingsByFile = new Map<string, typeof latestReview.findings>();
    for (const f of latestReview.findings) {
      const list = findingsByFile.get(f.file) ?? [];
      list.push(f);
      findingsByFile.set(f.file, list);
    }

    const hasReview =
      latestReview.findings.length > 0 || latestReview.reviewTokens !== null;

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
        const lineMap = new Map<number, { severity: string; id: string }>();
        for (const f of findings) {
          const existing = lineMap.get(f.startLine);
          if (
            !existing ||
            (severityRank[f.severity] ?? 0) > (severityRank[existing.severity] ?? 0)
          ) {
            lineMap.set(f.startLine, { severity: f.severity, id: f.id });
          }
        }
        return {
          ...file,
          finding_lines: [...new Set(findings.map((f) => f.startLine))].sort(
            (a, b) => a - b,
          ),
          severity_counts: hasReview
            ? {
                critical: findings.filter((f) => f.severity === "CRITICAL")
                  .length,
                warning: findings.filter((f) => f.severity === "WARNING")
                  .length,
                suggestion: findings.filter((f) => f.severity === "SUGGESTION")
                  .length,
              }
            : null,
          line_findings: hasReview
            ? [...lineMap.entries()].map(([line, { severity, id }]) => ({
                id,
                line,
                severity,
              }))
            : null,
        };
      }),
    }));

    return {
      ...base,
      groups: enrichedGroups,
      review_tokens: latestReview.reviewTokens,
    };
  }
}
