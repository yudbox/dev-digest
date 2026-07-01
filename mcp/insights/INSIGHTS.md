# MCP Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-06-29 — `DevDigestClient.request<T>()` returns a discriminated union `{ ok: true; data: T } | { ok: false; result: McpResult }` — check `result.ok` before accessing `data`. The early-return pattern `if (!result.ok) return result.result` keeps tool functions flat with no nested error branches. ref: mcp/src/api-client.ts:30

2026-06-29 — `deduplicateByAgent()` in `get-findings.ts` deduplicates by `agent_id` using a `Map<string, ReviewRow>` keyed on `agent_id`, keeping only the entry with the highest `created_at` string (ISO 8601 strings compare correctly lexicographically). Null-agent reviews (legacy rows without an agent) are collected separately and appended at the end unchanged. ref: mcp/src/tools/get-findings.ts:29

2026-06-29 — `get_blast_radius` tool collects cron jobs by iterating `factsByFile` values and building a `Set<string>` — deduplication is automatic. When `data.summary` is present (LLM-generated), it is preferred over the auto-built metric string. Pattern: `data.summary ?? \`${symbols} symbols, …\`` ref: mcp/src/tools/get-blast-radius.ts:41

## What Doesn't Work

2026-06-29 — `@devdigest/shared` TypeScript path alias is NOT available in the `mcp/` package — it has its own `package.json` and `tsconfig.json` that don't include the alias. Importing `BlastRadiusResult` from `@devdigest/shared` inside `mcp/src/` causes a module-not-found TS error. Fix: declare a local `interface` with a comment pointing to the canonical type in `server/src/vendor/shared/contracts/`. ref: mcp/src/tools/get-blast-radius.ts:4

## Codebase Patterns

2026-06-29 — Every tool function signature is `(client: DevDigestClient, args: { … }) => Promise<McpResult>`. The `client` is always the first argument. `server.ts` wires tools as `(args) => toolFn(client, args)` — the `client` closure comes from `createServer(client)`. Omitting `client` from the tool function call (writing `(args) => toolFn(args)`) compiles without error but throws at runtime because `client` is undefined inside the function. ref: mcp/src/server.ts:10

2026-06-29 — `mcpSuccess(data)` serializes `data` as `JSON.stringify(data)` into a single `{ type: "text", text }` content item. MCP clients receive one text block. Prefer flat objects over nested arrays-of-arrays so the LLM can parse the JSON without extra hops. Tool output shape matters: a `summary` string field at top level lets the LLM skip parsing the full payload when only a headline is needed. ref: mcp/src/api-client.ts:13

## Tool & Library Notes

2026-06-29 — `@modelcontextprotocol/sdk` `McpServer.tool()` signature: `(name, description, inputSchema, handler)`. `inputSchema` is a Zod object shape (not a full `z.object()` — just the inner record of fields). Optional fields must use `.optional()` or `.default()` on individual keys, not on the whole schema. ref: mcp/src/server.ts:16

2026-06-29 — MCP Inspector (`npx @modelcontextprotocol/inspector tsx --env-file=.env mcp/src/index.ts`) loads the server as a subprocess via stdio transport. Tool list appears after clicking "Connect" → "List Tools" in the UI. Tool call results appear as raw JSON text — the `isError: true` flag does NOT render differently in the Inspector; check the `isError` field in the response JSON manually. ref: mcp/src/index.ts:1

## Recurring Errors & Fixes

2026-06-29 — `get_findings` returned only 5 findings instead of the expected 20 when called without `all_runs: true`. Root cause: `deduplicateByAgent()` keeps only the latest run per agent — multiple earlier runs are silently dropped. This is correct behavior for the default case (latest verdict per agent), but confusing when debugging. To see all historical findings, pass `all_runs: true`. ref: mcp/src/tools/get-findings.ts:70

## Session Notes

2026-06-29 — MCP server integration: tested all 5 tools against yudbox/ai-customer-support repo via MCP Inspector. Fixed `get_blast_radius` stub (was returning `{stub: true}`) with real HTTP call to `GET /pulls/:id/blast`. Fixed `get_findings` deduplication — was returning all runs, now returns only latest per agent by default with `all_runs` flag to override. Files: mcp/src/tools/get-blast-radius.ts, mcp/src/tools/get-findings.ts, mcp/src/server.ts.

## Open Questions
