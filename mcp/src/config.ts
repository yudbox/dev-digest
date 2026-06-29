import { z } from "zod";

const ConfigSchema = z.object({
  apiUrl: z.string().url().default("http://localhost:3001"),
  pollIntervalMs: z.coerce.number().int().positive().default(2_000),
  pollTimeoutMs: z.coerce.number().int().positive().default(120_000),
});

export type McpConfig = z.infer<typeof ConfigSchema>;

export function readConfig(): McpConfig {
  return ConfigSchema.parse({
    apiUrl: process.env.DEVDIGEST_API_URL,
    pollIntervalMs: process.env.MCP_POLL_INTERVAL_MS,
    pollTimeoutMs: process.env.MCP_POLL_TIMEOUT_MS,
  });
}
