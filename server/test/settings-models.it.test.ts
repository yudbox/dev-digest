import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { SecretsProvider } from '@devdigest/shared';
import {
  resolveFeatureModelStrict,
  getFeatureModelOverride,
} from '../src/modules/settings/feature-models.js';
import { ValidationError } from '../src/platform/errors.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Settings: feature models + secrets status (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('resolveFeatureModelStrict: throws ValidationError (422) with no override, resolves once the workspace configures one', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: {} });

    // No override yet → getFeatureModelOverride is undefined and the strict
    // resolver throws instead of silently falling back to a registry default.
    expect(await getFeatureModelOverride(app.container, workspaceId, 'onboarding')).toBeUndefined();
    await expect(resolveFeatureModelStrict(app.container, workspaceId, 'onboarding')).rejects.toThrow(
      ValidationError,
    );
    await expect(resolveFeatureModelStrict(app.container, workspaceId, 'onboarding')).rejects.toThrow(
      /No model selected for .* — choose one in Settings → Feature Models/,
    );

    // Persist an override through the normal PUT /settings path.
    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { onboarding: { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' } } },
    });
    expect(put.statusCode).toBe(200);

    expect(await resolveFeatureModelStrict(app.container, workspaceId, 'onboarding')).toEqual({
      provider: 'openrouter',
      model: 'z-ai/glm-4.7-flash',
    });
    // An unset feature still throws — no silent registry-default fallback
    // for any feature id, not just the one that happens to be configured.
    await expect(resolveFeatureModelStrict(app.container, workspaceId, 'risk_brief')).rejects.toThrow(
      ValidationError,
    );

    await app.close();
  });

  it('GET /settings/secrets-status returns booleans only — never the key values', async () => {
    const secrets: SecretsProvider = {
      get: async (k) => (k === 'OPENROUTER_API_KEY' ? 'sk-or-secret-value' : undefined),
    };
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { secrets } });

    const res = await app.inject({ method: 'GET', url: '/settings/secrets-status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      openai: false,
      anthropic: false,
      openrouter: true,
      github: false,
      azureDevops: false,
    });
    // The actual secret must never appear in the response.
    expect(res.payload).not.toContain('sk-or-secret-value');

    await app.close();
  });
});
