/**
 * Direct OpenAI / Anthropic adapters never see a provider-billed cost — they
 * price tokens from a table. Their structured results must therefore be tagged
 * 'estimate' (never 'api'), or null when the model has no known price.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

const Out = z.object({ ok: z.boolean() });
const req = {
  model: "some-model",
  schema: Out,
  schemaName: "Out",
  messages: [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "x" },
  ],
};

function openai(estimate: (m: string, i: number, o: number) => number | null) {
  const provider = new OpenAIProvider("test-key", { estimateCost: estimate });
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
  (provider as unknown as { client: unknown }).client = { chat: { completions: { create } } };
  return provider;
}

function anthropic(estimate: (m: string, i: number, o: number) => number | null) {
  const provider = new AnthropicProvider("test-key", { estimateCost: estimate });
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "tool_use", id: "t1", name: "Out", input: { ok: true } }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  (provider as unknown as { client: unknown }).client = { messages: { create } };
  return provider;
}

describe("LLM adapters — costSource", () => {
  it("OpenAI: a priced model is tagged 'estimate'", async () => {
    const res = await openai(() => 0.25).completeStructured(req);
    expect(res.costUsd).toBe(0.25);
    expect(res.costSource).toBe("estimate");
  });

  it("OpenAI: an unpriced model is null/null", async () => {
    const res = await openai(() => null).completeStructured(req);
    expect(res.costUsd).toBeNull();
    expect(res.costSource).toBeNull();
  });

  it("Anthropic: a priced model is tagged 'estimate'", async () => {
    const res = await anthropic(() => 0.4).completeStructured(req);
    expect(res.costUsd).toBe(0.4);
    expect(res.costSource).toBe("estimate");
  });

  it("Anthropic: an unpriced model is null/null", async () => {
    const res = await anthropic(() => null).completeStructured(req);
    expect(res.costUsd).toBeNull();
    expect(res.costSource).toBeNull();
  });
});
