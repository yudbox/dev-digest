/**
 * OpenRouterProvider cost provenance: a provider-billed `usage.cost` wins and is
 * tagged 'api'; otherwise the injected price table is used and tagged 'estimate';
 * with neither, cost and source are both null.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

const Out = z.object({ ok: z.boolean() });

function providerWith(
  usage: Record<string, unknown>,
  estimateCost?: (m: string, i: number, o: number) => number | null,
) {
  const provider = new OpenRouterProvider('test-key', { estimateCost });
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
    usage,
  });
  (provider as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  return { provider, create };
}

const req = {
  model: 'm',
  schema: Out,
  schemaName: 'Out',
  messages: [{ role: 'user' as const, content: 'x' }],
};

describe('OpenRouterProvider — costSource', () => {
  it("tags a provider-reported usage.cost as 'api' and does not consult the price table", async () => {
    const estimate = vi.fn().mockReturnValue(9);
    const { provider } = providerWith({ prompt_tokens: 10, completion_tokens: 5, cost: 0.0123 }, estimate);
    const res = await provider.completeStructured(req);
    expect(res.costUsd).toBeCloseTo(0.0123, 9);
    expect(res.costSource).toBe('api');
    expect(estimate).not.toHaveBeenCalled();
  });

  it("falls back to the injected price table and tags it 'estimate'", async () => {
    const estimate = vi.fn().mockReturnValue(0.5);
    const { provider } = providerWith({ prompt_tokens: 10, completion_tokens: 5 }, estimate);
    const res = await provider.completeStructured(req);
    expect(res.costUsd).toBe(0.5);
    expect(res.costSource).toBe('estimate');
    expect(estimate).toHaveBeenCalledWith('m', 10, 5);
  });

  it('is null/null when there is no billed cost and no price for the model', async () => {
    const { provider } = providerWith({ prompt_tokens: 10, completion_tokens: 5 }, () => null);
    const res = await provider.completeStructured(req);
    expect(res.costUsd).toBeNull();
    expect(res.costSource).toBeNull();
  });

  it('is null/null when no price table is injected at all (CI runner)', async () => {
    const { provider } = providerWith({ prompt_tokens: 10, completion_tokens: 5 });
    const res = await provider.completeStructured(req);
    expect(res.costUsd).toBeNull();
    expect(res.costSource).toBeNull();
  });
});
