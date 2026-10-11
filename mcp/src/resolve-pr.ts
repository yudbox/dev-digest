import type { DevDigestClient, McpResult } from "./api-client.js";
import { mcpError } from "./api-client.js";

// Mirrors the relevant fields of GET /repos and GET /repos/:id/pulls.
interface RepoRow {
  id: string;
  name: string;
  full_name: string;
}

interface PullRow {
  id: string;
  number: number;
  title: string;
}

interface Candidate {
  id: string;
  number: number;
  title: string;
  repo: string;
}

export type ResolvedPr =
  | { ok: true; id: string }
  | { ok: false; result: McpResult };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_RE = /^#?(\d+)$/;
const MAX_LISTED = 10;

function matchesRepo(repo: RepoRow, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  const full = repo.full_name.toLowerCase();
  return (
    repo.id.toLowerCase() === f ||
    full === f ||
    repo.name.toLowerCase() === f ||
    full.endsWith(`/${f}`)
  );
}

function describe(c: Candidate): string {
  return `- ${c.repo} #${c.number} "${c.title}" (pr_id: ${c.id})`;
}

/**
 * Turns whatever the caller passed as `pr_id` into DevDigest's internal PR id.
 * Accepts the internal UUID as is, a GitHub PR number ("15" or "#15"), or a
 * fragment of the PR title. `repo` (id, "owner/name" or just "name") narrows
 * the search when a number or title matches PRs in several repositories.
 */
export async function resolvePrId(
  client: DevDigestClient,
  ref: string,
  repo?: string,
): Promise<ResolvedPr> {
  const value = ref.trim();
  if (UUID_RE.test(value)) return { ok: true, id: value };

  const reposResult = await client.request<RepoRow[]>("GET", "/repos");
  if (!reposResult.ok) return { ok: false, result: reposResult.result };

  const repos = repo
    ? reposResult.data.filter((r) => matchesRepo(r, repo))
    : reposResult.data;
  if (repos.length === 0) {
    const known = reposResult.data.map((r) => r.full_name).join(", ");
    return {
      ok: false,
      result: mcpError(
        `Repository '${repo}' not found. Known repositories: ${known || "none"}.`,
      ),
    };
  }

  // In parallel: listing a remote-backed repo's PRs can take seconds.
  const lists = await Promise.all(
    repos.map((r) =>
      client.request<PullRow[]>("GET", `/repos/${r.id}/pulls`),
    ),
  );
  const candidates: Candidate[] = [];
  for (const [i, pulls] of lists.entries()) {
    if (!pulls.ok) return { ok: false, result: pulls.result };
    for (const p of pulls.data) {
      candidates.push({ ...p, repo: repos[i]!.full_name });
    }
  }

  const numberMatch = NUMBER_RE.exec(value);
  const words = value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = numberMatch
    ? candidates.filter((c) => c.number === Number(numberMatch[1]))
    : candidates.filter((c) => {
        const title = c.title.toLowerCase();
        return words.every((w) => title.includes(w));
      });

  const scope = repo ? ` in '${repo}'` : "";
  const how = numberMatch ? `number #${numberMatch[1]}` : `title "${value}"`;

  if (matches.length === 1) return { ok: true, id: matches[0]!.id };

  if (matches.length === 0) {
    return {
      ok: false,
      result: mcpError(
        `No PR with ${how}${scope}. Pass the internal pr_id (UUID), a PR number like '#15', or part of the PR title; import missing PRs via the DevDigest UI.`,
      ),
    };
  }

  const listed = matches.slice(0, MAX_LISTED).map(describe).join("\n");
  const more =
    matches.length > MAX_LISTED
      ? `\n…and ${matches.length - MAX_LISTED} more.`
      : "";
  const hint = repo
    ? "Use a longer title fragment or one of the pr_id values above."
    : "Pass `repo` to narrow it down, or use one of the pr_id values above.";
  return {
    ok: false,
    result: mcpError(
      `${matches.length} PRs match ${how}${scope}:\n${listed}${more}\n${hint}`,
    ),
  };
}
