/**
 * F1 — repos module constants (extracted from routes.ts; no behaviour change).
 */

/** JobRunner kind for the asynchronous `git clone` job. */
export const CLONE_JOB_KIND = 'clone';

/** Clone depth — shallow clone (latest commit only) keeps imports fast. */
export const CLONE_DEPTH = 1;

/** Secret name (via the Secrets adapter) holding the GitHub PAT for private clones. */
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

/**
 * Parse `owner`/`repo` from a GitHub URL — supports both
 * `https://github.com/owner/repo(.git)` and `git@github.com:owner/repo.git`.
 */
export const GITHUB_URL_REGEX = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/;

/** Username embedded into an authenticated https github.com clone URL. */
export const GIT_TOKEN_USERNAME = 'x-access-token';

/** Host for which a token is embedded into an https clone URL. */
export const GITHUB_HTTPS_HOST = 'github.com';

// ---- Azure DevOps URL detection (SPEC-2026-08-25-azure-devops-integration) ----

/** Cloud Azure DevOps host — org + project both live in the URL path. */
export const AZURE_DEVOPS_HOST = 'dev.azure.com';

/** Base URL persisted for `dev.azure.com` repos (clone/API/deep-link root). */
export const AZURE_DEVOPS_BASE_URL = `https://${AZURE_DEVOPS_HOST}`;

/** Legacy cloud host suffix — the org lives in the SUBDOMAIN, not the path. */
export const AZURE_DEVOPS_VISUALSTUDIO_SUFFIX = '.visualstudio.com';

/**
 * Matches the three-level path shared by `dev.azure.com` and self-hosted
 * Azure DevOps Server (the "collection" plays the role of org):
 * `{org}/{project}/_git/{repo}`.
 */
export const AZURE_DEVOPS_ORG_PROJECT_REPO_REGEX =
  /^\/?([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/i;

/**
 * Matches the two-level path used by `{org}.visualstudio.com` once the org
 * (already read from the subdomain) is excluded: `{project}/_git/{repo}`.
 */
export const AZURE_DEVOPS_PROJECT_REPO_REGEX =
  /^\/?([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/i;

/** Shown in error messages so a malformed ADO URL points at the fix. */
export const AZURE_DEVOPS_URL_FORMAT_HINT =
  'expected https://dev.azure.com/{org}/{project}/_git/{repo}, https://{org}.visualstudio.com/{project}/_git/{repo}, or {base_url}/{collection}/{project}/_git/{repo} for a self-hosted server';
