import { describe, it, expect } from "vitest";
import { vcsPrUrl, vcsBlobUrl, type VcsUrlRepo } from "./vcsUrls";

const GH_REPO: VcsUrlRepo = {
  vcs_provider: "github",
  full_name: "acme/payments-api",
  owner: "acme",
  name: "payments-api",
};

const ADO_REPO: VcsUrlRepo = {
  vcs_provider: "azure-devops",
  full_name: "acme/payments-api",
  owner: "acme",
  name: "payments-api",
  project: "Payments",
  base_url: "https://dev.azure.com",
};

describe("vcsPrUrl", () => {
  it("builds a github.com PR URL, byte-identical to the old githubPrUrl output", () => {
    expect(vcsPrUrl(GH_REPO, 42)).toBe("https://github.com/acme/payments-api/pull/42");
  });

  it("builds an Azure DevOps PR URL: {baseUrl}/{org}/{project}/_git/{repo}/pullrequest/{id}", () => {
    expect(vcsPrUrl(ADO_REPO, 6557)).toBe(
      "https://dev.azure.com/acme/Payments/_git/payments-api/pullrequest/6557",
    );
  });

  it("falls back to the default cloud base URL when repo.base_url is unset", () => {
    const repo = { ...ADO_REPO, base_url: null };
    expect(vcsPrUrl(repo, 1)).toBe("https://dev.azure.com/acme/Payments/_git/payments-api/pullrequest/1");
  });

  it("strips a trailing slash from a self-hosted base_url", () => {
    const repo = { ...ADO_REPO, base_url: "https://ado.acme.internal/tfs/" };
    expect(vcsPrUrl(repo, 1)).toBe(
      "https://ado.acme.internal/tfs/acme/Payments/_git/payments-api/pullrequest/1",
    );
  });

  it("percent-encodes org/project/repo names containing spaces", () => {
    const repo = { ...ADO_REPO, owner: "Acme Corp", project: "Big Commerce Remediation" };
    expect(vcsPrUrl(repo, 1)).toBe(
      "https://dev.azure.com/Acme%20Corp/Big%20Commerce%20Remediation/_git/payments-api/pullrequest/1",
    );
  });
});

describe("vcsBlobUrl", () => {
  it("builds a github.com blob URL with a single line anchor", () => {
    expect(vcsBlobUrl(GH_REPO, "abc123", "src/index.ts", 10)).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/index.ts#L10",
    );
  });

  it("builds a github.com blob URL with a line range", () => {
    expect(vcsBlobUrl(GH_REPO, "abc123", "src/index.ts", 10, 15)).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/index.ts#L10-L15",
    );
  });

  it("collapses an identical start/end line to a single #L anchor", () => {
    expect(vcsBlobUrl(GH_REPO, "abc123", "src/index.ts", 10, 10)).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/index.ts#L10",
    );
  });

  it("builds a github.com blob URL with no line anchor at all", () => {
    expect(vcsBlobUrl(GH_REPO, "abc123", "src/index.ts")).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/index.ts",
    );
  });

  it("Azure DevOps: uses query params (path/version), not path segments or #L", () => {
    const url = new URL(vcsBlobUrl(ADO_REPO, "deadbeef", "src/index.ts"));
    expect(url.origin + url.pathname).toBe(
      "https://dev.azure.com/acme/Payments/_git/payments-api",
    );
    expect(url.searchParams.get("path")).toBe("/src/index.ts");
    expect(url.searchParams.get("version")).toBe("GCdeadbeef");
    expect(url.hash).toBe("");
  });

  it("Azure DevOps: defaults refType to commit (GC prefix)", () => {
    const url = new URL(vcsBlobUrl(ADO_REPO, "deadbeef", "src/index.ts"));
    expect(url.searchParams.get("version")).toBe("GCdeadbeef");
  });

  it("Azure DevOps: refType='branch' uses the GB prefix (onboarding's Critical Paths / Reading Path)", () => {
    const url = new URL(vcsBlobUrl(ADO_REPO, "main", "src/index.ts", undefined, undefined, "branch"));
    expect(url.searchParams.get("version")).toBe("GBmain");
  });

  it("Azure DevOps: a line range sets line/lineEnd query params", () => {
    const url = new URL(vcsBlobUrl(ADO_REPO, "deadbeef", "src/index.ts", 10, 15));
    expect(url.searchParams.get("line")).toBe("10");
    expect(url.searchParams.get("lineEnd")).toBe("15");
  });

  it("Azure DevOps: a single line sets lineEnd equal to line", () => {
    const url = new URL(vcsBlobUrl(ADO_REPO, "deadbeef", "src/index.ts", 10));
    expect(url.searchParams.get("line")).toBe("10");
    expect(url.searchParams.get("lineEnd")).toBe("10");
  });

  it("Azure DevOps: no line params at all when startLine is omitted", () => {
    const url = new URL(vcsBlobUrl(ADO_REPO, "deadbeef", "src/index.ts"));
    expect(url.searchParams.has("line")).toBe(false);
    expect(url.searchParams.has("lineEnd")).toBe(false);
  });

  it("Azure DevOps: the path query param always starts with a leading slash", () => {
    const url = new URL(vcsBlobUrl(ADO_REPO, "deadbeef", "nested/dir/file.ts"));
    expect(url.searchParams.get("path")).toBe("/nested/dir/file.ts");
  });
});
