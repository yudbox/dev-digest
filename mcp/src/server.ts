import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DevDigestClient } from "./api-client.js";
import { listAgents } from "./tools/list-agents.js";
import { runAgentOnPr } from "./tools/run-agent-on-pr.js";
import { getFindings } from "./tools/get-findings.js";
import { getConventions } from "./tools/get-conventions.js";
import { getBlastRadius } from "./tools/get-blast-radius.js";

export function createServer(client: DevDigestClient): McpServer {
  const server = new McpServer({
    name: "devdigest",
    version: "0.1.0",
  });

  // Read tools never mutate DevDigest state. Always use the 5-arg
  // tool(name, description, schema, annotations, cb) overload — with 4 args an
  // empty `{}` schema is ambiguous with annotations.
  const readOnly = { readOnlyHint: true } as const;

  server.tool(
    "list_agents",
    "List configured review agents with their IDs and models.",
    {},
    readOnly,
    () => listAgents(client),
  );

  server.tool(
    "run_agent_on_pr",
    "Run a review agent on a pull request and return findings.",
    {
      pr_id: z
        .string()
        .describe(
          "Pull request: DevDigest's internal pr_id (UUID, e.g. '5f5c6812-462d-4735-ad7c-4cadba36ce61'), the PR number (e.g. '#15' or '15'), or part of the PR title (e.g. 'cost tracking')",
        ),
      repo: z
        .string()
        .optional()
        .describe(
          "Optional repository to search in when pr_id is a number or title: 'owner/name', just 'name' (e.g. 'ai-customer-support'), or the repo id",
        ),
      agent_id: z
        .string()
        .describe(
          "Agent ID from list_agents, e.g. 'agent-456'. Always a specific agent — to run all agents call this tool once per agent.",
        ),
    },
    (args) => runAgentOnPr(client, args),
  );

  server.tool(
    "get_findings",
    "Get the latest review verdict and findings for a pull request, grouped by agent. Each review includes its findings nested inside. By default returns only the latest run per agent.",
    {
      pr_id: z
        .string()
        .describe(
          "Pull request: DevDigest's internal pr_id (UUID, e.g. '5f5c6812-462d-4735-ad7c-4cadba36ce61'), the PR number (e.g. '#15' or '15'), or part of the PR title (e.g. 'cost tracking')",
        ),
      repo: z
        .string()
        .optional()
        .describe(
          "Optional repository to search in when pr_id is a number or title: 'owner/name', just 'name' (e.g. 'ai-customer-support'), or the repo id",
        ),
      all_runs: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, return findings from all runs, not just the latest per agent",
        ),
    },
    readOnly,
    (args) => getFindings(client, args),
  );

  server.tool(
    "get_conventions",
    "Get accepted coding conventions for a repository.",
    {
      repo_id: z.string().describe("Repository ID, e.g. 'repo-789'"),
    },
    readOnly,
    (args) => getConventions(client, args),
  );

  server.tool(
    "get_blast_radius",
    "Get the blast radius (impact map) of a pull request — changed symbols, callers, impacted endpoints, and prior PRs touching the same files.",
    {
      pr_id: z
        .string()
        .describe(
          "Pull request: DevDigest's internal pr_id (UUID, e.g. '5f5c6812-462d-4735-ad7c-4cadba36ce61'), the PR number (e.g. '#15' or '15'), or part of the PR title (e.g. 'cost tracking')",
        ),
      repo: z
        .string()
        .optional()
        .describe(
          "Optional repository to search in when pr_id is a number or title: 'owner/name', just 'name' (e.g. 'ai-customer-support'), or the repo id",
        ),
    },
    readOnly,
    (args) => getBlastRadius(client, args),
  );

  return server;
}
