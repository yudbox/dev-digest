/** Constants for the settings module. */
import type { ConnTestProvider, SecretKey, SecretsStatus } from '@devdigest/shared';

/** Provider id used by the GitHub connection test branch. */
export const GITHUB_PROVIDER = 'github';

/** Provider id used by the Azure DevOps connection test branch. */
export const AZURE_DEVOPS_PROVIDER = 'azure-devops';

/** Maps a connection-test provider to the SecretsProvider key it persists to. */
export const SECRET_KEY_BY_PROVIDER: Record<ConnTestProvider, SecretKey> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  github: 'GITHUB_TOKEN',
  'azure-devops': 'AZURE_DEVOPS_TOKEN',
};

/**
 * `SecretsStatus` is a flat object whose field names don't all match
 * `ConnTestProvider` values verbatim — `'azure-devops'` (kebab-case, matches
 * the URL/DB `vcs_provider` convention) maps to `azureDevops` (camelCase,
 * matching the rest of the status object's fields).
 */
export const SECRETS_STATUS_FIELD_BY_PROVIDER: Record<ConnTestProvider, keyof SecretsStatus> = {
  openai: 'openai',
  anthropic: 'anthropic',
  openrouter: 'openrouter',
  github: 'github',
  'azure-devops': 'azureDevops',
};
