import { describe, it, expect } from 'vitest';
import {
  withGitHubToken,
  withAzureDevOpsToken,
  withVcsToken,
  buildCloneUrl,
} from './helpers.js';
import { AppError } from '../../platform/errors.js';

/**
 * TASK-005 (SPEC-2026-08-25-azure-devops-integration) — git-auth helpers.
 * No real network/PAT involved: these are pure string-transform unit tests.
 * A fake, obviously-non-secret placeholder token is used throughout —
 * never a real credential.
 */
describe('withGitHubToken (regression — must not change)', () => {
  it('embeds x-access-token:{token} into an https github.com URL', () => {
    expect(withGitHubToken('https://github.com/acme/api.git', 'fake-token')).toBe(
      'https://x-access-token:fake-token@github.com/acme/api.git',
    );
  });

  it('leaves a non-github.com URL untouched', () => {
    expect(withGitHubToken('https://dev.azure.com/acme/proj/_git/api', 'fake-token')).toBe(
      'https://dev.azure.com/acme/proj/_git/api',
    );
  });

  it('leaves an ssh URL untouched', () => {
    expect(withGitHubToken('git@github.com:acme/api.git', 'fake-token')).toBe(
      'git@github.com:acme/api.git',
    );
  });
});

describe('withAzureDevOpsToken', () => {
  it('embeds an EMPTY username + the PAT as password (Basic-auth convention, distinct from GitHub)', () => {
    const url = withAzureDevOpsToken('https://dev.azure.com/acme/proj/_git/api', 'fake-pat');
    const parsed = new URL(url);
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('fake-pat');
  });

  it('rewrites any https URL (not host-restricted — self-hosted base_url can be arbitrary)', () => {
    const url = withAzureDevOpsToken('https://ado.company.local/tfs/acme/proj/_git/api', 'fake-pat');
    expect(new URL(url).password).toBe('fake-pat');
  });
});

describe('withVcsToken (dispatcher)', () => {
  it('routes github to the x-access-token convention', () => {
    expect(withVcsToken('https://github.com/acme/api.git', 'github', 'fake-token')).toBe(
      'https://x-access-token:fake-token@github.com/acme/api.git',
    );
  });

  it('routes azure-devops to the empty-username Basic-auth convention', () => {
    const url = withVcsToken('https://dev.azure.com/acme/proj/_git/api', 'azure-devops', 'fake-pat');
    const parsed = new URL(url);
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('fake-pat');
  });
});

describe('buildCloneUrl (AC-42 — no more hardcoded https://github.com/${fullName}.git)', () => {
  it('builds a github clone URL from owner/name', () => {
    expect(buildCloneUrl({ vcsProvider: 'github', owner: 'acme', name: 'api' })).toBe(
      'https://github.com/acme/api.git',
    );
  });

  it('builds an azure-devops clone URL from base_url + owner/project/name', () => {
    expect(
      buildCloneUrl({
        vcsProvider: 'azure-devops',
        owner: 'acme-org',
        project: 'Widgets',
        name: 'api',
        baseUrl: 'https://dev.azure.com',
      }),
    ).toBe('https://dev.azure.com/acme-org/Widgets/_git/api');
  });

  it('throws when an azure-devops repo is missing base_url/project', () => {
    try {
      buildCloneUrl({ vcsProvider: 'azure-devops', owner: 'acme-org', name: 'api' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
    }
  });
});
