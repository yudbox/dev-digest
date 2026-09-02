import { describe, it, expect, afterEach } from "vitest";
import * as azdev from "azure-devops-node-api";
import { LocalSecretsProvider } from "../secrets/local.js";
import { loadConfig } from "../../platform/config.js";
import { AzureDevOpsClient } from "./client.js";

/**
 * TASK-008 — real-API verification against the actual Azure DevOps project
 * used throughout this plan (org GES-IT, project Big_Commerce_Remediation,
 * repo ges-azure-functions, PR #6557 — an open PR, chosen because thread
 * publishing needs a live PR; #6327 from TASK-006/007 is closed). Per the
 * plan/spec, mock tests alone are not sufficient for this critical path
 * ("mock-тестов недостаточно").
 *
 * SECURITY: the PAT is read ONLY via `LocalSecretsProvider.get()` — never
 * logged, never interpolated into an assertion message or test title.
 *
 * PRODUCTION HYGIENE: this test runs against a REAL, actively-reviewed pull
 * request in a real company's repository. Every thread it creates is
 * deleted in `afterEach` — `deleteComment` on every comment the test itself
 * created, tracked in `createdThreadIds`. Nothing this file does is meant to
 * be visible to a human reviewer of PR #6557 after the test run completes.
 * Uses a `finding-id-live-test-*` severity/title pair that cannot collide
 * with a real finding's `findingId`.
 *
 * Skipped (not failed) when no `AZURE_DEVOPS_TOKEN` is configured locally —
 * this test requires a real PAT and a real network call, so it cannot run
 * in ordinary CI (mirrors TASK-006/007's `.azure-devops.it.test.ts` files).
 */
const ORG = "GES-IT";
const PROJECT = "Big_Commerce_Remediation";
const REPO = "ges-azure-functions";
const PR_NUMBER = 6557;
const BASE_URL = "https://dev.azure.com";
const FILE_PATH = "apps/order-functions/src/functions/order-processing/order-processing-handler.ts";

const config = loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
const secrets = new LocalSecretsProvider(config.secretsPath);
const pat = await secrets.get("AZURE_DEVOPS_TOKEN");

const d = pat ? describe : describe.skip;

d("AzureDevOpsClient thread publishing — real Azure DevOps API (TASK-008)", () => {
  const repoRef = { owner: ORG, project: PROJECT, name: REPO, baseUrl: BASE_URL };
  const createdThreadIds: number[] = [];

  afterEach(async () => {
    if (createdThreadIds.length === 0) return;
    // Independent, minimal SDK connection for cleanup only — deliberately
    // NOT reaching into AzureDevOpsClient's private connection cache, so
    // this test stays honest about testing the PUBLIC port surface and
    // cleanup stays robust to internal refactors of client.ts.
    const authHandler = azdev.getPersonalAccessTokenHandler(pat!);
    const connection = new azdev.WebApi(`${BASE_URL}/${ORG}`, authHandler);
    const gitApi = await connection.getGitApi();
    const threads = await gitApi.getThreads(REPO, PR_NUMBER, PROJECT);
    for (const threadId of createdThreadIds) {
      const thread = threads.find((t) => t.id === threadId);
      for (const c of thread?.comments ?? []) {
        if (c.id != null) {
          await gitApi.deleteComment(REPO, PR_NUMBER, threadId, c.id, PROJECT);
        }
      }
    }
    createdThreadIds.length = 0;
  });

  it(
    "publishComment creates a real thread with the findingId property intact on read-back",
    async () => {
      const client = new AzureDevOpsClient(pat!);
      const result = await client.publishComment(repoRef, PR_NUMBER, {
        commitId: "unused-by-ado",
        path: FILE_PATH,
        line: 124,
        body: "Automated integration test comment — verifying thread creation. Safe to ignore.",
        severity: "info",
        title: "finding-id-live-test-create",
      });
      expect(result.thread_id).toBeTypeOf("number");
      createdThreadIds.push(result.thread_id!);
      expect(result.html_url).toContain(`pullrequest/${PR_NUMBER}?discussionId=${result.thread_id}`);
      expect(result.body).toContain("Automated integration test comment");
    },
    30_000,
  );

  it(
    "publishComment called twice with the same severity/title updates the SAME thread, not a second one (R33)",
    async () => {
      const client = new AzureDevOpsClient(pat!);
      const input = {
        commitId: "unused-by-ado",
        path: FILE_PATH,
        line: 200,
        body: "First publish of an idempotency test finding.",
        severity: "warning",
        title: "finding-id-live-test-idempotency",
      };
      const first = await client.publishComment(repoRef, PR_NUMBER, input);
      createdThreadIds.push(first.thread_id!);

      const second = await client.publishComment(repoRef, PR_NUMBER, {
        ...input,
        body: "Second publish of the SAME finding — reworded.",
      });

      expect(second.thread_id).toBe(first.thread_id);
    },
    30_000,
  );

  it(
    "listReviewComments excludes Azure DevOps' own System-type comments",
    async () => {
      const client = new AzureDevOpsClient(pat!);
      const comments = await client.listReviewComments(repoRef, PR_NUMBER);
      // This PR is known (from TASK-008 development) to carry real
      // System-type comments (ADO's auto-posted "iteration pushed" notices)
      // alongside real Text ones — the assertion that matters is not a
      // count (which drifts as the PR gets more activity over time) but
      // that every comment RETURNED reads as ordinary review content, never
      // one of ADO's own system-generated notices.
      for (const c of comments) {
        expect(c.body.toLowerCase()).not.toMatch(/iteration \d+ was created|pushed \d+ commit/);
      }
    },
    30_000,
  );
});
