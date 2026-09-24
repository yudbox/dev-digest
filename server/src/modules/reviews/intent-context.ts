/**
 * Application-layer helpers for gathering extra Intent context (SPEC-2026-09-23
 * -smart-diff-hw3-upgrade, AC-39..44): a linked issue's body, and a plan/spec
 * file referenced in the PR body — both read best-effort and passed to the
 * Intent LLM as labelled untrusted text. Container ports + pure functions
 * only — no Drizzle, no Fastify.
 */
import type { Container } from "../../platform/container.js";
import type { IssueMeta } from "@devdigest/shared";
import type { RunLogger } from "../../platform/run-logger.js";
import { buildRepoRef, type RepoRow } from "../_shared/diff/diff-loader.js";

/** Truncation limits for untrusted text passed to the Intent LLM (NC-3 default). */
export const ISSUE_BODY_MAX_CHARS = 1000;
export const PLAN_MAX_CHARS = 2000;

/**
 * Allowed plan/spec link pattern (NC-2 default): an optional single-segment
 * module prefix, then `specs/` or `plans/`, then `PLAN-` or `SPEC-` followed
 * by letters/digits/`_`/`-`, ending in `.md`. Anchored full-string match — no
 * absolute paths, no `..` traversal, no other extensions, no URLs (a full URL
 * like `https://.../specs/PLAN-x.md` never matches this anchored pattern).
 */
export const PLAN_PATH_PATTERN =
  /^(?:[A-Za-z0-9_-]+\/)?(?:specs|plans)\/(?:PLAN|SPEC)-[A-Za-z0-9_-]+\.md$/;

/** `Closes|Fixes|Resolves #N` — moved from `run-executor.ts` (unchanged regex). */
export function extractLinkedIssueNumber(
  body: string | null | undefined,
): number | undefined {
  if (!body) return undefined;
  const m = body.match(/(Closes|Fixes|Resolves)\s+#(\d+)/i);
  return m ? parseInt(m[2]!, 10) : undefined;
}

/**
 * First token in `body` matching `PLAN_PATH_PATTERN` — tokenised on
 * whitespace and markdown-link punctuation (`()[]<>"'\``), trailing
 * `.,;:!?` stripped (so "See specs/PLAN-x.md." in prose still matches).
 * Returns `undefined` when no link matches (AC-42 — no read for that link).
 */
export function extractPlanPath(body: string | null | undefined): string | undefined {
  if (!body) return undefined;
  const tokens = body.split(/[\s()[\]<>"'`]+/).filter(Boolean);
  for (const raw of tokens) {
    const token = raw.replace(/[.,;:!?]+$/, "");
    if (PLAN_PATH_PATTERN.test(token)) return token;
  }
  return undefined;
}

/** Q4 default wording — only the failed clause(s), joined by `; `. `undefined`
 *  when nothing is missing (R44 — no note when all context was fetched OK,
 *  or there was nothing to fetch). */
export function buildMissingContextNote(missing: {
  issueNumber?: number;
  planPath?: string;
}): string | undefined {
  const clauses: string[] = [];
  if (missing.issueNumber !== undefined) {
    clauses.push(`linked issue #${missing.issueNumber} could not be fetched`);
  }
  if (missing.planPath !== undefined) {
    clauses.push(`plan ${missing.planPath} could not be read`);
  }
  if (clauses.length === 0) return undefined;
  return `⚠ Context incomplete: ${clauses.join("; ")}.`;
}

export interface IntentContext {
  issue?: IssueMeta;
  plan?: { path: string; content: string };
  missing: { issueNumber?: number; planPath?: string };
}

/**
 * Best-effort gather of the linked issue + plan/spec file. Every failure is
 * logged to `runLog` and recorded in `missing` — this function never throws
 * (Reliability: a fetch/read failure must not fail the run).
 *
 * `headSha` is the PR head revision to read the plan from (`resolvedHeadSha`
 * from `loadDiff` — see Q1); `null` means the head commit isn't known to be
 * present in the local clone, so the plan counts as "could not be read".
 */
export async function gatherIntentContext(
  container: Container,
  repoRow: RepoRow,
  pull: { body: string | null },
  headSha: string | null,
  runLog: RunLogger,
): Promise<IntentContext> {
  const missing: { issueNumber?: number; planPath?: string } = {};

  let issue: IssueMeta | undefined;
  const issueNumber = extractLinkedIssueNumber(pull.body);
  if (issueNumber !== undefined) {
    try {
      const vcs = await container.vcs(repoRow);
      issue = await vcs.getIssue(buildRepoRef(repoRow), issueNumber);
      runLog.info(
        `Intent: linked issue #${issueNumber} fetched — "${issue?.title}"`,
      );
    } catch (err) {
      runLog.info(
        `Intent: linked issue #${issueNumber} fetch failed — ${(err as Error).message}`,
      );
      missing.issueNumber = issueNumber;
    }
  }

  let plan: { path: string; content: string } | undefined;
  const planPath = extractPlanPath(pull.body);
  if (planPath !== undefined) {
    if (headSha === null) {
      runLog.info(
        `Intent: plan ${planPath} could not be read — PR head not available in local clone`,
      );
      missing.planPath = planPath;
    } else {
      try {
        const content = await container.git.readFileAtRef(
          buildRepoRef(repoRow),
          headSha,
          planPath,
        );
        plan = { path: planPath, content };
      } catch (err) {
        runLog.info(
          `Intent: plan ${planPath} could not be read — ${(err as Error).message}`,
        );
        missing.planPath = planPath;
      }
    }
  }

  return { issue, plan, missing };
}
