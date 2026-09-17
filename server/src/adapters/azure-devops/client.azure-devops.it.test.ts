import { describe, it, expect } from "vitest";
import { LocalSecretsProvider } from "../secrets/local.js";
import { loadConfig } from "../../platform/config.js";
import { AzureDevOpsClient } from "./client.js";

/**
 * TASK-006 — real-API verification against the actual Azure DevOps project
 * used throughout this plan (org GES-IT, project Big_Commerce_Remediation,
 * repo ges-azure-functions, PR #6327). Per the plan/spec, mock tests alone
 * are not sufficient for this critical path ("mock-тестов недостаточно").
 *
 * SECURITY: the PAT is read ONLY via `LocalSecretsProvider.get()` (the exact
 * class `container.secrets` resolves to in production) and passed straight
 * into `AzureDevOpsClient`'s constructor — never logged, never interpolated
 * into an assertion message or test title, never written anywhere.
 * `LocalSecretsProvider.set()` is never called in this file.
 *
 * Skipped (not failed) when no `AZURE_DEVOPS_TOKEN` is configured locally —
 * this test requires a real PAT and a real network call, so it cannot run in
 * ordinary CI.
 */
const ORG = "GES-IT";
const PROJECT = "Big_Commerce_Remediation";
const REPO = "ges-azure-functions";
const PR_NUMBER = 6327;
const BASE_URL = "https://dev.azure.com";

const config = loadConfig({ ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
const secrets = new LocalSecretsProvider(config.secretsPath);
const pat = await secrets.get("AZURE_DEVOPS_TOKEN");

const d = pat ? describe : describe.skip;

d("AzureDevOpsClient — real Azure DevOps API (TASK-006)", () => {
  const repoRef = { owner: ORG, project: PROJECT, name: REPO, baseUrl: BASE_URL };

  it(
    "listPullRequests returns real PRs mapped to PrMeta with a numeric-status-derived string status",
    async () => {
      const client = new AzureDevOpsClient(pat!);
      const prs = await client.listPullRequests(repoRef);
      expect(prs.length).toBeGreaterThan(0);
      const target = prs.find((p) => p.number === PR_NUMBER);
      expect(target).toBeDefined();
      expect(["open", "merged", "closed"]).toContain(target!.status);
      expect(target!.additions).toBe(0);
      expect(target!.deletions).toBe(0);
      expect(target!.files_count).toBe(0);
      expect(target!.head_sha).toMatch(/^[0-9a-f]{40}$/);
    },
    30_000,
  );

  it(
    "getPullRequest backfills real files_count/commits for PR #6327; linked_issue is never set (R23)",
    async () => {
      const client = new AzureDevOpsClient(pat!);
      const detail = await client.getPullRequest(repoRef, PR_NUMBER);

      expect(detail.number).toBe(PR_NUMBER);
      expect(detail.files.length).toBeGreaterThan(0);
      expect(detail.files_count).toBe(detail.files.length);
      // TASK-006 scope: patch is always null here — TASK-007 fills it from
      // the local diff.
      for (const f of detail.files) {
        expect(f.patch).toBeNull();
      }
      expect(detail.commits.length).toBeGreaterThan(0);
      // R23 — ADO Work Items are out of scope; never guess a linked issue
      // even if the real PR body happens to contain a GitHub-style
      // "Closes #N" convention.
      expect(detail.linked_issue).toBeUndefined();
    },
    30_000,
  );

  it(
    "listWorkflowRuns still throws not_supported against the real client instance",
    async () => {
      const client = new AzureDevOpsClient(pat!);
      await expect(client.listWorkflowRuns(repoRef)).rejects.toThrow(/azure-devops.*listWorkflowRuns/);
    },
    30_000,
  );
});
