import type { McpConfig } from "./config.js";

export interface McpResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export function mcpError(text: string): McpResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function mcpSuccess(data: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export class DevDigestClient {
  private readonly baseUrl: string;
  readonly config: McpConfig;

  constructor(config: McpConfig) {
    this.config = config;
    this.baseUrl = config.apiUrl;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<
    | { ok: true; data: T }
    | { ok: false; status: number | null; result: McpResult }
  > {
    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      return {
        ok: false,
        status: null,
        result: mcpError(
          `Cannot reach DevDigest API at ${this.baseUrl}. Is the server running?`,
        ),
      };
    }

    if (response.status === 404) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        status: 404,
        result: mcpError(text || `Not found: ${path}`),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        result: mcpError(
          `DevDigest API error: ${response.status}. Check server logs.`,
        ),
      };
    }

    try {
      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch {
      return {
        ok: false,
        status: response.status,
        result: mcpError(
          `DevDigest API at ${this.baseUrl} returned invalid JSON for ${path}.`,
        ),
      };
    }
  }
}
