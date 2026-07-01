import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig } from "./config.js";
import { DevDigestClient } from "./api-client.js";
import { createServer } from "./server.js";

const config = readConfig();
const client = new DevDigestClient(config);
const server = createServer(client);
const transport = new StdioServerTransport();

await server.connect(transport);
