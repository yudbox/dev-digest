/* vcsUrls.ts — build provider-aware deep-links (PR / file blob) from data we
   already hold on a `Repo` row. GitHub and Azure DevOps use structurally
   different URL shapes (path segments + #L{n} vs. query params), so both
   builders branch on `repo.vcs_provider` rather than assuming a single host.

   TASK-010 (SPEC-2026-08-25-azure-devops-integration, R52). Renamed from the
   GitHub-only `githubUrls.ts`. */
import type { VcsProvider } from "@devdigest/shared";

const GITHUB_HOST = "https://github.com";
const ADO_DEFAULT_BASE_URL = "https://dev.azure.com";

/** The subset of a `Repo` row needed to build a deep-link — callers can pass
 * an `activeRepo` straight through, or any object with these fields. */
export interface VcsUrlRepo {
  vcs_provider: VcsProvider;
  full_name: string;
  owner: string;
  name: string;
  /** Azure DevOps only. */
  project?: string | null;
  /** Azure DevOps only. */
  base_url?: string | null;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Encode a repo-relative path for a URL while keeping "/" separators. */
function encPath(file: string): string {
  return file
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/** `https://github.com/{owner}/{repo}/pull/{number}` |
 * `{baseUrl}/{org}/{project}/_git/{repo}/pullrequest/{number}` */
export function vcsPrUrl(repo: VcsUrlRepo, number: number): string {
  if (repo.vcs_provider === "azure-devops") {
    const base = stripTrailingSlash(repo.base_url ?? ADO_DEFAULT_BASE_URL);
    return `${base}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.project ?? "")}/_git/${encodeURIComponent(repo.name)}/pullrequest/${number}`;
  }
  return `${GITHUB_HOST}/${repo.full_name}/pull/${number}`;
}

/**
 * `https://github.com/{owner}/{repo}/blob/{ref}/{file}#L{start}[-L{end}]` |
 * `{baseUrl}/{org}/{project}/_git/{repo}?path={file}&version=G{B|C}{ref}&line=…`
 *
 * `refType` picks Azure DevOps' version prefix (`GB` branch vs. `GC` commit —
 * ADO has no single "just resolve this ref" form the way GitHub's `/blob/`
 * does). Defaults to `"commit"` since most callers pin to a PR's head sha;
 * onboarding's Critical Paths / Reading Path sections link to the default
 * branch and pass `"branch"` explicitly.
 */
export function vcsBlobUrl(
  repo: VcsUrlRepo,
  ref: string,
  file: string,
  startLine?: number,
  endLine?: number,
  refType: "commit" | "branch" = "commit",
): string {
  if (repo.vcs_provider === "azure-devops") {
    const base = stripTrailingSlash(repo.base_url ?? ADO_DEFAULT_BASE_URL);
    const url = new URL(
      `${base}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.project ?? "")}/_git/${encodeURIComponent(repo.name)}`,
    );
    url.searchParams.set("path", file.startsWith("/") ? file : `/${file}`);
    url.searchParams.set("version", `${refType === "branch" ? "GB" : "GC"}${ref}`);
    url.searchParams.set("_a", "contents");
    if (startLine != null) {
      url.searchParams.set("line", String(startLine));
      url.searchParams.set("lineEnd", String(endLine ?? startLine));
      url.searchParams.set("lineStartColumn", "1");
      url.searchParams.set("lineEndColumn", "1");
      url.searchParams.set("lineStyle", "plain");
    }
    return url.toString();
  }
  let url = `${GITHUB_HOST}/${repo.full_name}/blob/${ref}/${encPath(file)}`;
  if (startLine != null) {
    url += `#L${startLine}`;
    if (endLine != null && endLine !== startLine) url += `-L${endLine}`;
  }
  return url;
}
