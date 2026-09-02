import { simpleGit, type SimpleGit } from 'simple-git';
import { join, dirname } from 'node:path';
import { mkdir, readFile, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
  VcsProvider,
} from '@devdigest/shared';
import { parseUnifiedDiff } from './diff-parser.js';

/** A `RepoRef` that may carry the provider discriminator (Azure DevOps
 * multi-provider support — SPEC-2026-08-25-azure-devops-integration). Optional
 * and defaulted to `'github'` everywhere it's read, so every pre-existing
 * `RepoRef` (which never set it) is unaffected. */
type VcsRepoRef = RepoRef & { provider?: VcsProvider };

/**
 * Strip embedded Basic-auth credentials (`user:pass@`) from a clone/fetch URL
 * so the caller-visible, persisted copy never carries a PAT. SSH-style URLs
 * (`git@host:owner/repo.git`) aren't valid `URL` instances and never carried
 * credentials this way in the first place — returned unchanged.
 */
function stripCredentials(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
      return u.toString();
    }
  } catch {
    /* not an absolute URL (e.g. ssh form) — nothing to strip */
  }
  return url;
}

/**
 * Redact an embedded Basic-auth password (the PAT) out of a thrown git
 * error's message/stack before it propagates to `JobRunner`'s persisted
 * `error` column or any other log sink (AC-005-3/AC-009-2 — PAT must never
 * appear in logs, including error/retry paths). Git's own stderr sometimes
 * echoes the exact URL it failed to reach (e.g. "fatal: Authentication
 * failed for '<url>'"), so this cannot assume git already redacts it.
 */
function redactUrlCredential(err: unknown, url: string): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  let password: string | undefined;
  try {
    password = new URL(url).password || undefined;
  } catch {
    /* non-URL — nothing to redact */
  }
  if (!password) return original;
  const redacted = new Error(original.message.split(password).join('<redacted>'));
  redacted.name = original.name;
  if (original.stack) redacted.stack = original.stack.split(password).join('<redacted>');
  return redacted;
}

/**
 * Depth fetched by `sync()`. Deeper than the shallow clone (CLONE_DEPTH=1) so the
 * previously-indexed sha is usually reachable, keeping the resync diff incremental;
 * when it isn't, the indexer falls back to a full reindex.
 */
const RESYNC_FETCH_DEPTH = 50;

/**
 * GitClient over simple-git. Repos clone to
 * `<cloneDir>/<owner>/<repo>`. We NEVER execute repo code — only git ops.
 */
export class SimpleGitClient implements GitClient {
  constructor(private cloneDir: string) {
    // Force non-interactive auth so an unauthenticated/private clone fails in
    // ~1s with a clear error instead of hanging on a credential prompt until the
    // job timeout. Set on process.env (inherited by git subprocesses) rather
    // than via simple-git's .env(), which inspects and rejects vars like
    // PAGER/EDITOR present in the shell environment.
    process.env.GIT_TERMINAL_PROMPT ??= '0';
    process.env.GCM_INTERACTIVE ??= 'never';
  }

  /**
   * `provider === 'github'` (or unset — every pre-existing `RepoRef` never
   * set it) keeps the ORIGINAL path byte-for-byte
   * (`<cloneDir>/<owner>/<name>`) — required so existing on-disk clones are
   * never "lost" by a path scheme change (AC-005-5). Azure DevOps routes
   * through a provider-segmented path (`<cloneDir>/azure-devops/<owner>/[<project>/]<name>`)
   * so it can never collide with a same-named GitHub repo (P2 — SPEC-2026-08-25-azure-devops-integration).
   */
  clonePathFor(repo: VcsRepoRef): string {
    if (repo.provider === 'azure-devops') {
      const segments = [this.cloneDir, repo.provider, repo.owner];
      if (repo.project) segments.push(repo.project);
      segments.push(repo.name);
      return join(...segments);
    }
    return join(this.cloneDir, repo.owner, repo.name);
  }

  private git(repo: VcsRepoRef): SimpleGit {
    return simpleGit(this.clonePathFor(repo));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async clone(repo: VcsRepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }> {
    try {
      return await this.cloneInner(repo, url, opts);
    } catch (err) {
      // AC-005-3/AC-009-2 — never let an authenticated URL's PAT leak into a
      // thrown error's message/stack (which `JobRunner` persists verbatim as
      // the job's `error` column).
      throw redactUrlCredential(err, url);
    }
  }

  private async cloneInner(
    repo: VcsRepoRef,
    url: string,
    opts?: CloneOptions,
  ): Promise<{ path: string }> {
    const dest = this.clonePathFor(repo);
    // `dirname(dest)` (not the old hardcoded `<cloneDir>/<owner>`) so the
    // deeper Azure DevOps path (`<cloneDir>/azure-devops/<owner>/<project>`)
    // gets created too. For GitHub, `dirname(dest) === <cloneDir>/<owner>` —
    // identical to before this change.
    await mkdir(dirname(dest), { recursive: true });
    if (await this.exists(join(dest, '.git'))) {
      if (repo.provider === 'azure-devops') {
        // Azure DevOps: origin never carries credentials (see below) — every
        // re-fetch authenticates via the freshly-supplied `url` directly,
        // never relying on (or rewriting) the stored origin URL.
        await simpleGit(dest).fetch([url, '+refs/heads/*:refs/remotes/origin/*']);
      } else {
        // GitHub — unchanged. Bare `fetch()` relies on origin's stored URL,
        // which already carries the token embedded at the original clone.
        await simpleGit(dest).fetch();
      }
      return { path: dest };
    }
    // A prior clone may have timed out mid-write, leaving a partial dir without
    // a .git — git clone refuses a non-empty dest, so clear it first.
    if (await this.exists(dest)) await rm(dest, { recursive: true, force: true });
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await simpleGit(this.cloneDir).clone(url, dest, args);
    if (repo.provider === 'azure-devops') {
      // AC-005-1 / R41 — the PAT must never persist in `.git/config`. GitHub's
      // origin URL is deliberately left untouched (existing, working
      // behavior other code — e.g. the incremental indexer's `sync()` —
      // still relies on): this branch only changes Azure DevOps, which is
      // new in this task and has no such pre-existing dependency.
      const clean = stripCredentials(url);
      if (clean !== url) {
        await simpleGit(dest).remote(['set-url', 'origin', clean]);
      }
    }
    return { path: dest };
  }

  async fetchPullHead(repo: VcsRepoRef, n: number, url?: string): Promise<string> {
    try {
      return await this.fetchPullHeadInner(repo, n, url);
    } catch (err) {
      // AC-005-3/AC-009-2 — see `clone()`'s equivalent guard above.
      throw url ? redactUrlCredential(err, url) : err;
    }
  }

  private async fetchPullHeadInner(repo: VcsRepoRef, n: number, url?: string): Promise<string> {
    if (repo.provider === 'azure-devops') {
      // `refs/pull/{id}/merge` is the confirmed-working ADO refspec
      // (TASK-000 spike, `adapters/azure-devops/SPIKE-NOTES.md`) —
      // `refs/pull/{id}/head` does not exist server-side on Azure DevOps.
      // One fetch of the merge ref also brings the base commit along for
      // free (its two parents are exactly the target/source commits).
      // Authenticate via the caller-supplied `url` directly: Azure DevOps'
      // `origin` remote never carries credentials (see `clone()` above), so
      // fetching by literal 'origin' name here would fail to authenticate.
      if (!url) {
        throw new Error("fetchPullHead: an authenticated 'url' is required for azure-devops");
      }
      // `+` forces the local `pr-{n}` ref to update even when it isn't a
      // fast-forward of its previous value — confirmed live (2026-09-02,
      // GES-IT PR #6557 after a real push moved its head): ADO regenerates
      // `refs/pull/{n}/merge` as a BRAND NEW synthetic merge commit on every
      // PR update, unrelated in history to the previous one, so a plain
      // (non-forced) refspec update is rejected as non-fast-forward. Without
      // `+`, git.fetch() THROWS "! [rejected] ... (non-fast-forward)" on any
      // re-fetch after the PR's head has moved — a message `classifyGitError`
      // doesn't recognize, so it falls through to the generic `diff_failed`,
      // permanently stuck on the PR's ORIGINAL head forever after. Only the
      // very first fetch (no pre-existing local ref) ever worked, which is
      // why TASK-000/TASK-007's tests (always a fresh clone) never caught it.
      await this.git(repo).fetch([url, `+refs/pull/${n}/merge:pr-${n}`]);
      // `pr-{n}` is the synthetic MERGE commit, not the PR head itself — its
      // second parent is the real source-branch head (TASK-000 spike). This
      // is the sha callers must treat as "the commit we actually reviewed" —
      // never `pull.headSha` read back from the DB, which this same fetch
      // may have just superseded (2026-09-02 finding: a review triggered
      // right after a fresh push must not silently diff/label against the
      // PR's previous head).
      return (await this.git(repo).revparse([`pr-${n}^2`])).trim();
    }
    // GitHub — same non-fast-forward risk in principle (a force-push or
    // rebase on the PR branch would hit the identical rejection), so `+` is
    // applied here too for consistency even though GitHub's `pull/<n>/head`
    // is far less likely to diverge non-linearly than ADO's regenerated
    // merge commit. `origin`'s stored URL already carries the token embedded
    // at the original clone. Unlike Azure DevOps, `pr-{n}` here IS the head
    // commit directly (no merge-commit wrapping) — same "trust this, not a
    // possibly-stale `pull.headSha`" reasoning as above.
    await this.git(repo).fetch(['origin', `+pull/${n}/head:pr-${n}`]);
    return (await this.git(repo).revparse([`pr-${n}`])).trim();
  }

  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    // Resync the read-only mirror to upstream. A bare `fetch` only moves
    // `origin/<branch>`, so we `reset --hard` to advance local HEAD + worktree —
    // safe here because we never commit to or run code from the clone.
    // Fetch a bounded depth (> the shallow CLONE_DEPTH) so the prior indexed sha
    // is usually reachable for an incremental diff; the indexer falls back to a
    // full reindex when it isn't.
    const g = this.git(repo);
    await g.fetch(['origin', branch, '--depth', String(RESYNC_FETCH_DEPTH)]);
    await g.reset(['--hard', `origin/${branch}`]);
    return { head: (await g.revparse(['HEAD'])).trim() };
  }

  async currentHead(repo: RepoRef): Promise<string> {
    return (await this.git(repo).revparse(['HEAD'])).trim();
  }

  async diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff> {
    const raw = await this.git(repo).diff([`${base}...${head}`]);
    return parseUnifiedDiff(raw);
  }

  /**
   * `git diff --name-only base..head` — used by the incremental indexer to
   * pick the file set that changed since `last_indexed_sha`. Two-dot is
   * intentional (commits reachable from `head` but not `base`), unlike the
   * three-dot symmetric form `diff()` uses for review diffs.
   */
  async diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const raw = await this.git(repo).raw(['diff', '--name-only', `${base}..${head}`]);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async blame(repo: RepoRef, path: string): Promise<BlameLine[]> {
    const raw = await this.git(repo).raw(['blame', '--line-porcelain', path]);
    return parseBlamePorcelain(raw);
  }

  async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
    const log = await this.git(repo).log(path ? { file: path } : undefined);
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  async readFile(repo: RepoRef, path: string): Promise<string> {
    return readFile(join(this.clonePathFor(repo), path), 'utf8');
  }
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = raw.split('\n');
  let sha = '';
  let author = '';
  let date = '';
  let summary = '';
  let lineNo = 0;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (header) {
      sha = header[1]!;
      lineNo = Number(header[2]);
    } else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time '))
      date = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      out.push({ line: lineNo, sha, author, date, summary });
    }
  }
  return out;
}
