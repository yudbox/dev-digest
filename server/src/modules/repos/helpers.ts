import { type Repo, type VcsProvider } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { AppError } from '../../platform/errors.js';
import {
  GITHUB_URL_REGEX,
  GIT_TOKEN_USERNAME,
  GITHUB_HTTPS_HOST,
  AZURE_DEVOPS_HOST,
  AZURE_DEVOPS_BASE_URL,
  AZURE_DEVOPS_VISUALSTUDIO_SUFFIX,
  AZURE_DEVOPS_ORG_PROJECT_REPO_REGEX,
  AZURE_DEVOPS_PROJECT_REPO_REGEX,
  AZURE_DEVOPS_URL_FORMAT_HINT,
} from './constants.js';

/**
 * F1 — repos pure helpers (extracted from routes.ts; no behaviour change).
 * Pure functions only — no I/O, no DB, no container.
 */

export type ParsedRepoUrl =
  | { provider: 'github'; owner: string; name: string; project?: undefined; baseUrl?: undefined }
  | { provider: 'azure-devops'; owner: string; name: string; project: string; baseUrl: string };

/** Explicit provider selection, required when a URL's host isn't auto-detected. */
export interface ParseRepoUrlOptions {
  vcsProvider?: VcsProvider;
  /** Required (and enforced by the request Zod schema) when `vcsProvider === 'azure-devops'`. */
  baseUrl?: string;
}

/**
 * Parse a repo URL into a discriminated `{provider, owner, name, project?, baseUrl?}`.
 *
 * Detection order: GitHub (https/ssh, unchanged regex — AC-004-1 requires
 * byte-identical GitHub behavior) → `dev.azure.com` → `*.visualstudio.com` →
 * unrecognized host, which requires an explicit `opts.vcsProvider` (+
 * `opts.baseUrl` for Azure DevOps) or throws `provider_required` (NOT
 * `invalid_repo_url` — a distinct code the caller uses to show a
 * provider-picker form instead of a generic error).
 */
export function parseRepoUrl(url: string, opts: ParseRepoUrlOptions = {}): ParsedRepoUrl {
  // https://github.com/owner/repo(.git)  |  git@github.com:owner/repo.git
  const ghMatch = url.match(GITHUB_URL_REGEX);
  if (ghMatch?.[1] && ghMatch[2]) {
    return { provider: 'github', owner: ghMatch[1], name: ghMatch[2] };
  }

  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(url);
  } catch {
    // Not an absolute URL DevDigest recognizes (e.g. a malformed ssh-like
    // string that also failed the GitHub regex above) — falls through below.
  }

  if (parsedUrl) {
    const host = parsedUrl.hostname.toLowerCase();

    if (host === AZURE_DEVOPS_HOST) {
      return parseAdoOrgProjectRepoPath(parsedUrl.pathname, url, AZURE_DEVOPS_BASE_URL, undefined);
    }

    if (host.endsWith(AZURE_DEVOPS_VISUALSTUDIO_SUFFIX)) {
      const org = host.slice(0, -AZURE_DEVOPS_VISUALSTUDIO_SUFFIX.length);
      if (org) {
        const m = parsedUrl.pathname.match(AZURE_DEVOPS_PROJECT_REPO_REGEX);
        if (!m?.[1] || !m[2]) {
          throw new AppError(
            'invalid_repo_url',
            `Could not parse an Azure DevOps project/repo from '${url}' — ${AZURE_DEVOPS_URL_FORMAT_HINT}`,
            400,
          );
        }
        return {
          provider: 'azure-devops',
          owner: org,
          project: m[1],
          name: m[2],
          baseUrl: `https://${org}${AZURE_DEVOPS_VISUALSTUDIO_SUFFIX}`,
        };
      }
    }
  }

  // Unrecognized host — only proceeds with an explicit manual provider pick.
  if (opts.vcsProvider === 'azure-devops') {
    if (!opts.baseUrl) {
      // Defense-in-depth: the route's Zod `.superRefine()` already requires
      // `base_url` at the request-validation layer before this ever runs.
      throw new AppError('invalid_repo_url', "Azure DevOps requires a 'base_url'", 400);
    }
    return parseAdoOrgProjectRepoPath(
      url.startsWith(opts.baseUrl) ? url.slice(opts.baseUrl.length) : url,
      url,
      opts.baseUrl,
      opts.baseUrl,
    );
  }

  if (opts.vcsProvider === 'github') {
    throw new AppError('invalid_repo_url', `Could not parse owner/repo from '${url}'`, 400);
  }

  throw new AppError(
    'provider_required',
    `Could not auto-detect a VCS provider for '${url}' — select a provider and base URL`,
    400,
  );
}

/** Shared `{org}/{project}/_git/{repo}` path parser for dev.azure.com and self-hosted ADO Server. */
function parseAdoOrgProjectRepoPath(
  path: string,
  originalUrl: string,
  baseUrl: string,
  selfHostedBaseUrl: string | undefined,
): ParsedRepoUrl {
  const m = path.match(AZURE_DEVOPS_ORG_PROJECT_REPO_REGEX);
  if (!m?.[1] || !m[2] || !m[3]) {
    const relativeHint = selfHostedBaseUrl ? ` relative to base_url '${selfHostedBaseUrl}'` : '';
    throw new AppError(
      'invalid_repo_url',
      `Could not parse an Azure DevOps org/project/repo from '${originalUrl}'${relativeHint} — ${AZURE_DEVOPS_URL_FORMAT_HINT}`,
      400,
    );
  }
  return { provider: 'azure-devops', owner: m[1], project: m[2], name: m[3], baseUrl };
}

/**
 * Embed a token into an https github.com URL so private clones authenticate
 * non-interactively. SSH/non-GitHub URLs are left untouched.
 */
export function withGitHubToken(url: string, token: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === GITHUB_HTTPS_HOST) {
      u.username = GIT_TOKEN_USERNAME;
      u.password = token;
      return u.toString();
    }
  } catch {
    /* non-URL (e.g. git@github.com:...) — leave as-is */
  }
  return url;
}

/**
 * Embed a PAT into an https Azure DevOps clone URL. Azure DevOps' Basic-auth
 * convention is DIFFERENT from GitHub's — EMPTY username, PAT as the
 * password (confirmed in `adapters/azure-devops/auth.ts`'s `adoAuthHeader`
 * and TASK-000's spike) — so this cannot reuse `withGitHubToken`'s
 * `x-access-token:{token}` scheme as-is. Any https URL is rewritten (not
 * host-restricted like GitHub's) since a self-hosted Azure DevOps Server can
 * live at an arbitrary `base_url`.
 */
export function withAzureDevOpsToken(url: string, token: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      u.username = '';
      u.password = token;
      return u.toString();
    }
  } catch {
    /* non-URL — leave as-is */
  }
  return url;
}

/**
 * Provider dispatcher for clone-URL token embedding (TASK-005, R41/AC-42).
 * Replaces direct calls to `withGitHubToken` at call sites that need to
 * support both providers — GitHub's exact scheme/behavior is unchanged.
 */
export function withVcsToken(url: string, provider: VcsProvider, token: string): string {
  if (provider === 'azure-devops') return withAzureDevOpsToken(url, token);
  return withGitHubToken(url, token);
}

/**
 * Rebuild a repo's (unauthenticated) clone URL from its persisted identity —
 * used by `RepoService.refresh()`, which (unlike `add()`) has no original
 * user-supplied URL to reuse. Removes the `https://github.com/${fullName}.git`
 * literal that previously hardcoded GitHub as the only provider (AC-42).
 */
export function buildCloneUrl(repo: {
  vcsProvider: VcsProvider;
  owner: string;
  name: string;
  project?: string | null;
  baseUrl?: string | null;
}): string {
  if (repo.vcsProvider === 'azure-devops') {
    if (!repo.baseUrl || !repo.project) {
      throw new AppError(
        'invalid_repo_url',
        'Azure DevOps repo is missing base_url/project — cannot rebuild its clone URL',
        400,
      );
    }
    const base = repo.baseUrl.replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.name)}`;
  }
  return `https://${GITHUB_HTTPS_HOST}/${repo.owner}/${repo.name}.git`;
}

/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    vcs_provider: row.vcsProvider as VcsProvider,
    owner: row.owner,
    name: row.name,
    project: row.project,
    base_url: row.baseUrl,
    full_name: row.fullName,
    default_branch: row.defaultBranch,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    created_by: row.createdBy,
  };
}
