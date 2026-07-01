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

  server.tool(
    "list_agents",
    "List configured review agents with their IDs and models.",
    {},
    () => listAgents(client),
  );

  server.tool(
    "run_agent_on_pr",
    "Run a review agent on a pull request and return findings.",
    {
      pr_id: z.string().describe("Pull request ID, e.g. 'pr-abc123'"),
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
      pr_id: z.string().describe("Pull request ID, e.g. 'pr-abc123'"),
      all_runs: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, return findings from all runs, not just the latest per agent",
        ),
    },
    (args) => getFindings(client, args),
  );

  server.tool(
    "get_conventions",
    "Get accepted coding conventions for a repository.",
    {
      repo_id: z.string().describe("Repository ID, e.g. 'repo-789'"),
    },
    (args) => getConventions(client, args),
  );

  server.tool(
    "get_blast_radius",
    "Get the blast radius (impact map) of a pull request — changed symbols, callers, impacted endpoints, and prior PRs touching the same files.",
    {
      pr_id: z.string().describe("Pull request ID, e.g. 'pr-abc123'"),
    },
    (args) => getBlastRadius(client, args),
  );

  return server;
}
