import { describe, it, expect } from 'vitest';
import { parseRepoUrl } from './helpers.js';
import { AppError } from '../../platform/errors.js';

/**
 * TASK-004 of SPEC-2026-08-25-azure-devops-integration — table-driven
 * `parseRepoUrl` coverage: GitHub (https + ssh, unchanged behavior),
 * `dev.azure.com`, `*.visualstudio.com`, self-hosted Azure DevOps Server
 * (manual provider + base_url), unknown hosts (`provider_required`), and
 * malformed Azure DevOps URLs (`invalid_repo_url` with a format hint).
 */
describe('parseRepoUrl', () => {
  describe('GitHub (AC-004-1 — behavior must not change)', () => {
    it('parses an https URL', () => {
      expect(parseRepoUrl('https://github.com/acme/api')).toEqual({
        provider: 'github',
        owner: 'acme',
        name: 'api',
      });
    });

    it('parses an https URL with a trailing .git', () => {
      expect(parseRepoUrl('https://github.com/acme/api.git')).toEqual({
        provider: 'github',
        owner: 'acme',
        name: 'api',
      });
    });

    it('parses an ssh URL', () => {
      expect(parseRepoUrl('git@github.com:acme/api.git')).toEqual({
        provider: 'github',
        owner: 'acme',
        name: 'api',
      });
    });
  });

  describe('Azure DevOps Services — dev.azure.com (AC-004-2)', () => {
    it('parses org/project/repo and sets base_url to https://dev.azure.com', () => {
      expect(
        parseRepoUrl('https://dev.azure.com/acme-org/Widgets/_git/api'),
      ).toEqual({
        provider: 'azure-devops',
        owner: 'acme-org',
        project: 'Widgets',
        name: 'api',
        baseUrl: 'https://dev.azure.com',
      });
    });

    it('strips a trailing .git', () => {
      expect(
        parseRepoUrl('https://dev.azure.com/acme-org/Widgets/_git/api.git'),
      ).toEqual({
        provider: 'azure-devops',
        owner: 'acme-org',
        project: 'Widgets',
        name: 'api',
        baseUrl: 'https://dev.azure.com',
      });
    });
  });

  describe('Azure DevOps Services — legacy *.visualstudio.com (AC-004-2)', () => {
    it('parses org from the subdomain and project/repo from the path', () => {
      expect(
        parseRepoUrl('https://acme-org.visualstudio.com/Widgets/_git/api'),
      ).toEqual({
        provider: 'azure-devops',
        owner: 'acme-org',
        project: 'Widgets',
        name: 'api',
        baseUrl: 'https://acme-org.visualstudio.com',
      });
    });
  });

  describe('Self-hosted Azure DevOps Server (AC-004-4)', () => {
    it('parses collection/project/repo relative to the given base_url', () => {
      expect(
        parseRepoUrl('https://ado.company.local/tfs/DefaultCollection/Widgets/_git/api', {
          vcsProvider: 'azure-devops',
          baseUrl: 'https://ado.company.local/tfs',
        }),
      ).toEqual({
        provider: 'azure-devops',
        owner: 'DefaultCollection',
        project: 'Widgets',
        name: 'api',
        baseUrl: 'https://ado.company.local/tfs',
      });
    });

    it('throws invalid_repo_url (not provider_required) when base_url is missing', () => {
      try {
        parseRepoUrl('https://ado.company.local/tfs/DefaultCollection/Widgets/_git/api', {
          vcsProvider: 'azure-devops',
        });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('invalid_repo_url');
      }
    });
  });

  describe('Unknown host (AC-004-3)', () => {
    it('throws provider_required, not invalid_repo_url, with no manual provider given', () => {
      try {
        parseRepoUrl('https://ado.company.local/tfs/DefaultCollection/Widgets/_git/api');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('provider_required');
      }
    });
  });

  describe('Malformed Azure DevOps URLs (AC-004-5)', () => {
    it('rejects a dev.azure.com URL missing _git/{repo}', () => {
      try {
        parseRepoUrl('https://dev.azure.com/acme-org/Widgets');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('invalid_repo_url');
        expect((err as AppError).message).toMatch(/_git/);
      }
    });

    it('rejects a *.visualstudio.com URL missing all three segments', () => {
      try {
        parseRepoUrl('https://acme-org.visualstudio.com/_git/');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('invalid_repo_url');
      }
    });
  });

  describe('Genuinely invalid input', () => {
    it('rejects a github.com URL with no owner/repo segments', () => {
      try {
        parseRepoUrl('https://github.com/');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        // Falls through to the "unrecognized shape" path since the GitHub
        // regex itself doesn't match — no manual provider was given either.
        expect((err as AppError).code).toBe('provider_required');
      }
    });
  });
});
